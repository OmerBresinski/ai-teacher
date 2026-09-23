import type { Slide } from "@tj/domain/documents";
import { chooseVariant, type Personality, wordCount } from "./choose-variant";
import { uid } from "./factories";
import type { VariantName } from "./layouts";
import { type IdSupplier, type MaterialiseMeta, materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";

/*
 * A ten-slide lesson as specs (ADR 0025 §8), the shape the plan prompt asks for: title and
 * objectives first, one vocabulary slide, two question slides, an exit ticket last. It is the
 * water cycle demo's content, so the screenshot specs and the layout tests render the same
 * lesson the library seeds. No model call: `demoLessonSlides` runs it through `chooseVariant`
 * and `materialiseSlide`, which is the whole catalogue on one deck.
 */

export const DEMO_LESSON_SPECS: readonly SlideSpec[] = [
  {
    kind: "title",
    factRefs: [],
    title: "The water cycle",
    subtitle: "Year 5. Where rain comes from",
  },
  {
    kind: "objectives",
    factRefs: ["o1", "o2", "o3"],
    items: [
      "Name the four stages of the water cycle",
      "Explain what happens to water when it is heated",
      "Describe where the water in a cloud came from",
    ],
  },
  {
    kind: "starter",
    factRefs: ["q1"],
    items: [
      "Name three places you find water outdoors",
      "What happens to a puddle on a hot day?",
      "Stretch: why does a cold window go misty?",
    ],
    footnote: "5 minutes. Work in silence and answer in your book.",
  },
  {
    kind: "vocabulary",
    factRefs: ["v1", "v2", "v3", "v4"],
    entries: [
      { term: "evaporation", definition: "Liquid water heats up and turns into a gas." },
      { term: "condensation", definition: "Water vapour cools down and turns back into a liquid." },
      { term: "precipitation", definition: "Water falls as rain, hail, sleet or snow." },
      { term: "collection", definition: "Water gathers in rivers, lakes and the sea." },
    ],
  },
  {
    kind: "content",
    factRefs: ["o1", "o2"],
    heading: "The sun powers the whole cycle",
    // Thirty-one words: two columns with the callout under them (over twenty-four), within the
    // thirty-six the columns hold above a card (`CALLOUT_TWO_COLUMN_MIN_WORDS`).
    body: "The sun heats water in rivers, lakes and seas until it evaporates into water vapour. High in the sky the vapour cools and condenses into tiny droplets that gather into cloud.",
    // The demo's misconception, as the true-false slide checks it (UX ruling 84).
    callout: {
      kind: "watch-out",
      text: "Clouds are tiny drops of liquid water, not water vapour; vapour is invisible.",
    },
  },
  {
    kind: "image-text",
    factRefs: ["o3"],
    heading: "Clouds over the sea",
    body: "Warm air rises from the sea carrying water vapour. As it climbs it cools, and the vapour condenses into the clouds you can see.",
  },
  {
    kind: "content",
    factRefs: ["o3"],
    heading: "Nothing is lost",
    body: "The water you drink today has been round the cycle millions of times.",
  },
  {
    kind: "worked-example",
    factRefs: ["w1"],
    question: "Why does a puddle disappear on a sunny day?",
    steps: [
      "The sun warms the water in the puddle.",
      "Some of it becomes water vapour and rises into the air.",
      "The puddle shrinks until it has all evaporated.",
    ],
  },
  {
    kind: "true-false",
    factRefs: ["m1"],
    statement: "Clouds are made of water vapour.",
    correct: false,
    explanation: "Clouds are tiny droplets of liquid water. Water vapour is invisible.",
  },
  {
    kind: "exit-ticket",
    factRefs: ["o1", "o2"],
    items: [
      "Name the stage where water turns into a gas",
      "Where does the energy for the water cycle come from?",
      "Write one question you still have",
    ],
    footnote: "Answer on a sticky note and hand it to me on the way out",
  },
];

/** The words `chooseVariant` weighs for a spec: the body, the items, or the title. */
export function specWordCount(spec: SlideSpec): number {
  switch (spec.kind) {
    case "title":
      return wordCount(spec.title);
    case "content":
    case "image-text":
      return wordCount(spec.body);
    case "objectives":
    case "starter":
    case "plenary":
      return wordCount(spec.items.join(" "));
    case "exit-ticket":
      return wordCount(spec.items.join(" "));
    case "instructions":
      return wordCount(spec.steps.join(" "));
    default:
      return 0;
  }
}

export type DemoLessonOptions = {
  ids?: IdSupplier;
  meta?: MaterialiseMeta;
  personality?: Personality;
  /** Whether the title slide has a photograph to place. */
  titleImage?: boolean;
  /** Replace the ten specs, for a test that wants another outline. */
  specs?: readonly SlideSpec[];
};

const DEMO_META: MaterialiseMeta = {
  promptVersion: "fixture",
  model: "fixture",
  at: "2026-09-09T09:00:00.000Z",
};

/**
 * Lay the specs out through the variety rules: each slide's variant from `chooseVariant`
 * over its place in the deck, then `materialiseSlide`. Returns the slides and the variant
 * each was given, in order.
 */
export function demoLessonSlides(
  themeId: string,
  options: DemoLessonOptions = {},
): { slides: Slide[]; variants: VariantName[] } {
  const specs = options.specs ?? DEMO_LESSON_SPECS;
  const ids = options.ids ?? uid;
  const meta = options.meta ?? DEMO_META;
  const slides: Slide[] = [];
  const variants: VariantName[] = [];
  let contentSeen = false;
  specs.forEach((spec, index) => {
    const previous = specs[index - 1];
    const firstContent = spec.kind === "content" && !contentSeen;
    if (spec.kind === "content") contentSeen = true;
    const variant = chooseVariant(spec.kind, {
      firstContent,
      hasCallout: "callout" in spec && spec.callout !== undefined,
      index,
      total: specs.length,
      hasImage: spec.kind === "image-text" || (spec.kind === "title" && !!options.titleImage),
      textLength: specWordCount(spec),
      previousVariant: variants[index - 1] ?? null,
      previousKind: previous?.kind ?? null,
      personality: options.personality,
    });
    variants.push(variant);
    slides.push(materialiseSlide(spec, themeId, meta, ids, variant));
  });
  return { slides, variants };
}
