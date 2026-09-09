import type {
  GapTextElement,
  LessonFacts,
  OptionElement,
  QuestionData,
  Slide,
  SlideElement,
  SlideKind,
  TextElement,
} from "@tj/domain/documents";
import { docToPlainText } from "../text/static";
import { docFromText, newSlide, newText, now, uid } from "./factories";
import { colLeft, SAFE } from "./grid";
import { boxH, derange, SLIDE_KIND_LABELS } from "./layouts";
import { getTheme } from "./themes";

/*
 * The activity picker's catalogue and the pure derivations behind it (TEACH-185, UX rulings
 * 46 to 55). One activity is one card: a slide kind plus, for "Which are true", the `multi`
 * flag. `buildActivity` returns the slide a card previews and inserts: derived from the lesson's
 * `facts` when they carry enough, the `layouts.ts` fixture otherwise, and then shaped by the tier
 * chip. Every derived element records the fact ids it came from in `generatedFrom.factRefs`, the
 * same field the regenerate cascade and the impact preview read, so a fact edit finds it.
 */

export type ActivityId =
  | "true-false"
  | "multiple-choice"
  | "which-are-true"
  | "fill-gap"
  | "matching"
  | "image-match"
  | "sort"
  | "open-response"
  | "discussion"
  | "do-now"
  | "exit-ticket"
  | "timer";

export type ActivityTier = "support" | "core" | "challenge";

export const ACTIVITY_TIERS: { value: ActivityTier; label: string }[] = [
  { value: "support", label: "Support" },
  { value: "core", label: "Core" },
  { value: "challenge", label: "Challenge" },
];

export type ActivityGroupId = "check" | "apply" | "structure";

export const ACTIVITY_GROUPS: { id: ActivityGroupId; label: string; activities: ActivityId[] }[] = [
  {
    id: "check",
    label: "Check",
    activities: ["true-false", "multiple-choice", "which-are-true", "fill-gap"],
  },
  {
    id: "apply",
    label: "Apply",
    activities: ["matching", "image-match", "sort", "open-response", "discussion"],
  },
  { id: "structure", label: "Structure", activities: ["do-now", "exit-ticket", "timer"] },
];

/** The slide kind each card inserts. */
export const ACTIVITY_KIND: Record<ActivityId, SlideKind> = {
  "true-false": "true-false",
  "multiple-choice": "multiple-choice",
  "which-are-true": "multiple-choice",
  "fill-gap": "fill-gap",
  matching: "matching",
  "image-match": "image-match",
  sort: "sort",
  "open-response": "open-response",
  discussion: "discussion",
  "do-now": "starter",
  "exit-ticket": "exit-ticket",
  timer: "timer",
};

export const ACTIVITY_LABELS: Record<ActivityId, string> = {
  "true-false": "True or false",
  "multiple-choice": "Multiple choice",
  "which-are-true": "Which are true",
  "fill-gap": "Fill the gap",
  matching: "Matching",
  "image-match": "Image matching",
  sort: "Sort",
  "open-response": "Open response",
  discussion: "Discussion",
  "do-now": "Do now",
  "exit-ticket": "Exit ticket",
  timer: "Timer",
};

/** What pupils see, in the order they see it. */
export const ACTIVITY_DESCRIPTIONS: Record<ActivityId, string> = {
  "true-false":
    "Pupils see one statement and two cards; the wrong card dims, then the right one fills on Answer",
  "multiple-choice": "Pupils see four options; the right one fills on Answer",
  "which-are-true": "Pupils see four statements; the two true ones fill on Answer",
  "fill-gap": "Pupils see a sentence with blanks; the missing words appear on Answer",
  matching: "Pupils see terms and definitions; lines join the pairs on Answer",
  "image-match": "Pupils see pictures and words; the right word lands under each picture on Answer",
  sort: "Pupils see cards out of order; the right numbers appear on Answer",
  "open-response": "Pupils see a question and space to write; the model answer appears on Answer",
  discussion: "Pupils see one prompt and how to talk about it",
  "do-now": "Pupils see retrieval questions to start on as they sit down",
  "exit-ticket": "Pupils see three questions to answer before they leave",
  timer: "Pupils see a countdown for a task",
};

/** Whole minutes the activity is expected to take, on every card (ruling 55). */
export const ACTIVITY_MINUTES: Record<ActivityId, number> = {
  "true-false": 2,
  "multiple-choice": 3,
  "which-are-true": 3,
  "fill-gap": 3,
  matching: 5,
  "image-match": 5,
  sort: 5,
  "open-response": 8,
  discussion: 5,
  "do-now": 5,
  "exit-ticket": 5,
  timer: 5,
};

export type ActivityOptions = {
  facts?: LessonFacts;
  tier?: ActivityTier;
};

/** The one entry point: the slide a card previews and inserts. */
export function buildActivity(
  id: ActivityId,
  themeId: string,
  { facts, tier = "core" }: ActivityOptions = {},
): Slide {
  const derived = facts ? deriveActivity(id, facts, themeId) : null;
  const slide = derived ?? fixtureActivity(id, themeId);
  return applyTier(slide, tier, themeId);
}

/** A derived slide when the facts carry enough for the activity, else `null`. */
export function deriveActivity(id: ActivityId, facts: LessonFacts, themeId: string): Slide | null {
  switch (id) {
    case "matching":
      return deriveMatching(facts, themeId);
    case "fill-gap":
      return deriveFillGap(facts, themeId);
    case "sort":
      return deriveSort(facts, themeId);
    case "true-false":
      return deriveTrueFalse(facts, themeId);
    case "multiple-choice":
      return deriveMultipleChoice(facts, themeId);
    case "which-are-true":
      return deriveWhichAreTrue(facts, themeId);
    case "open-response":
      return deriveOpenResponse(facts, themeId);
    default:
      return null;
  }
}

/** The `layouts.ts` fixture for the card; "Which are true" is the multiple choice one, `multi`. */
export function fixtureActivity(id: ActivityId, themeId: string): Slide {
  const slide = newSlide(ACTIVITY_KIND[id], themeId);
  if (id !== "which-are-true" || slide.question?.type !== "multiple-choice") return slide;
  const options = optionsOf(slide);
  const statements = [
    "Ice melts when it warms up",
    "Water boils at 100 °C at sea level",
    "Steam is colder than ice",
    "Rain falls upwards",
  ];
  options.forEach((o, i) => {
    setText(o, statements[i] ?? "");
  });
  setText(stemOf(slide), "Which of these are true?");
  slide.question = {
    type: "multiple-choice",
    multi: true,
    options: slide.question.options.map((o, i) => ({ id: o.id, correct: i < 2 })),
  };
  return slide;
}

/** Every fact id the slide's elements were derived from, in first-seen order. */
export function slideFactRefs(slide: Slide): string[] {
  const refs: string[] = [];
  const walk = (els: SlideElement[]) => {
    for (const el of els) {
      for (const ref of el.generatedFrom?.factRefs ?? []) if (!refs.includes(ref)) refs.push(ref);
      if (el.type === "group") walk(el.children);
    }
  };
  walk(slide.elements);
  return refs;
}

/* ------------------------------------------------------------------ */
/* Derivations                                                         */
/* ------------------------------------------------------------------ */

const RIGHT_X = colLeft(6);

/** Matching from the first four vocabulary pairs; definitions deranged so no row gives itself away. */
export function deriveMatching(facts: LessonFacts, themeId: string): Slide | null {
  const pairs = facts.vocabulary.slice(0, 4);
  if (pairs.length < 2) return null;
  const slide = newSlide("matching", themeId);
  const texts = slide.elements.filter((el): el is TextElement => el.type === "text");
  const stem = texts[0];
  const leftTemplate = texts.find((t, i) => i > 0 && t.x === SAFE.x);
  const rightTemplate = texts.find((t) => t.x === RIGHT_X);
  if (!stem || !leftTemplate || !rightTemplate) return null;
  // Four rows need a tighter pitch than the fixture's three to stay inside the safe area.
  const rows = pairs.length;
  const pitch = rows === 4 ? 80 : 88;
  const h = rows === 4 ? 66 : 72;
  const top = rows === 4 ? 170 : 190;
  const shuffle = derange(rows);
  const left = pairs.map((v, i) =>
    withRefs({ ...leftTemplate, id: uid(), y: top + i * pitch, h, doc: docFromText(v.term) }, [
      v.id,
    ]),
  );
  const right = pairs.map((v, i) =>
    withRefs(
      {
        ...rightTemplate,
        id: uid(),
        y: top + (shuffle[i] ?? i) * pitch,
        h,
        doc: docFromText(v.definition),
      },
      [v.id],
    ),
  );
  slide.elements = [stem, ...left, ...right];
  slide.question = {
    type: "matching",
    pairs: pairs.map((_, i) => ({
      id: uid(),
      leftElementId: left[i]?.id ?? "",
      rightElementId: right[i]?.id ?? "",
    })),
  };
  return slide;
}

/** Fill the gap from the first two definitions, each with its term gapped. */
export function deriveFillGap(facts: LessonFacts, themeId: string): Slide | null {
  const items = facts.vocabulary.slice(0, 2);
  if (items.length === 0) return null;
  const slide = newSlide("fill-gap", themeId);
  const gapText = slide.elements.find((el): el is GapTextElement => el.type === "gap-text");
  if (!gapText) return null;
  const gaps = items.map((v) => ({ id: uid(), answer: v.term }));
  const lines = items.map((v, i) => gapSentence(v.term, v.definition, gaps[i]?.id ?? ""));
  replaceElement(
    slide,
    gapText,
    withRefs(
      { ...gapText, doc: docFromText(lines.join("\n")) },
      items.map((v) => v.id),
    ),
  );
  slide.question = { type: "fill-gap", gaps };
  return slide;
}

/** The definition with the term blanked where it appears, else the term blanked in front of it. */
function gapSentence(term: string, definition: string, gapId: string): string {
  const token = `[[gap:${gapId}]]`;
  const at = definition.toLowerCase().indexOf(term.toLowerCase());
  if (at >= 0) return definition.slice(0, at) + token + definition.slice(at + term.length);
  return `${token}: ${definition}`;
}

/** Sort from the outline order: the first four entries, each named by the fact it covers. */
export function deriveSort(facts: LessonFacts, themeId: string): Slide | null {
  const entries = facts.outline.slice(0, 4);
  if (entries.length < 2) return null;
  const slide = newSlide("sort", themeId);
  const cards = optionsOf(slide);
  if (cards.length < entries.length) return null;
  const shuffle = derange(entries.length);
  // Each card keeps a fixture slot's geometry, but sits in a deranged slot so the correct order
  // is something to work out; `question.order` still lists the cards in outline order.
  const slots = cards.map((c) => ({ x: c.x, y: c.y }));
  const sorted = entries.map((entry, i) => {
    const template = cards[i];
    const slot = slots[shuffle[i] ?? i];
    if (!template || !slot) throw new Error("sort fixture has fewer than four cards");
    return withRefs(
      {
        ...template,
        id: uid(),
        x: slot.x,
        y: slot.y,
        label: undefined,
        doc: docFromText(outlineEntryText(entry, facts)),
      },
      entry.factRefs,
    );
  });
  slide.elements = [stemOf(slide), ...sorted];
  slide.question = { type: "sort", order: sorted.map((c) => c.id) };
  return slide;
}

/** The first fact an outline entry covers, as a card's words; the kind's label when none resolves. */
function outlineEntryText(entry: LessonFacts["outline"][number], facts: LessonFacts): string {
  for (const ref of entry.factRefs) {
    const text =
      facts.objectives.find((f) => f.id === ref)?.text ??
      facts.vocabulary.find((f) => f.id === ref)?.term ??
      facts.questions.find((f) => f.id === ref)?.stem ??
      facts.workedExamples.find((f) => f.id === ref)?.problem;
    if (text) return text;
  }
  return SLIDE_KIND_LABELS[entry.kind];
}

/** True or false: a misconception is the false statement; failing one, a definition is true. */
export function deriveTrueFalse(facts: LessonFacts, themeId: string): Slide | null {
  const misconception = facts.misconceptions[0];
  const vocab = facts.vocabulary[0];
  const source = misconception
    ? { text: misconception.belief, correct: false, ref: misconception.id }
    : vocab
      ? { text: `${vocab.term}: ${vocab.definition}`, correct: true, ref: vocab.id }
      : null;
  if (!source) return null;
  const slide = newSlide("true-false", themeId);
  const stem = stemOf(slide);
  replaceElement(slide, stem, withRefs({ ...stem, doc: docFromText(source.text) }, [source.ref]));
  slide.question = { type: "true-false", correct: source.correct };
  return slide;
}

/** Multiple choice: the first question, its answer, and three misconceptions as distractors. */
export function deriveMultipleChoice(facts: LessonFacts, themeId: string): Slide | null {
  const q = facts.questions[0];
  if (!q) return null;
  const distractors = distractorsFor(q.id, facts, 3);
  const slide = newSlide("multiple-choice", themeId);
  const options = optionsOf(slide);
  if (options.length < 4) return null;
  // The right answer moves with the stem so it is not always card A.
  const correctAt = q.stem.length % options.length;
  const choices = [...distractors];
  choices.splice(correctAt, 0, { text: q.answer, refs: [q.id] });
  const stem = stemOf(slide);
  replaceElement(slide, stem, withRefs({ ...stem, doc: docFromText(q.stem) }, [q.id]));
  options.forEach((o, i) => {
    const choice = choices[i];
    if (!choice) return;
    replaceElement(slide, o, withRefs({ ...o, doc: docFromText(choice.text) }, choice.refs));
  });
  slide.question = {
    type: "multiple-choice",
    options: options.map((o, i) => ({ id: o.id, correct: i === correctAt })),
  };
  return slide;
}

/** Wrong options: misconceptions first, then other questions' answers, then terms, then a stock line. */
function distractorsFor(
  questionId: string,
  facts: LessonFacts,
  count: number,
): { text: string; refs: string[] }[] {
  const pool: { text: string; refs: string[] }[] = [
    ...facts.misconceptions.map((m) => ({ text: m.belief, refs: [m.id] })),
    ...facts.questions
      .filter((o) => o.id !== questionId)
      .map((o) => ({ text: o.answer, refs: [o.id] })),
    ...facts.vocabulary.map((v) => ({ text: v.term, refs: [v.id] })),
  ];
  const out = pool.slice(0, count);
  while (out.length < count) out.push({ text: "None of these", refs: [] });
  return out;
}

/** Which are true: two definitions are true; misconceptions, then mismatched pairs, are false. */
export function deriveWhichAreTrue(facts: LessonFacts, themeId: string): Slide | null {
  const vocab = facts.vocabulary;
  if (vocab.length < 2) return null;
  const truths = vocab
    .slice(0, 2)
    .map((v) => ({ text: `${v.term}: ${v.definition}`, refs: [v.id] }));
  const falsehoods: { text: string; refs: string[] }[] = facts.misconceptions
    .slice(0, 2)
    .map((m) => ({ text: m.belief, refs: [m.id] }));
  // A term paired with another's definition is false and reads like the true ones.
  for (let i = 0; falsehoods.length < 2 && i < vocab.length; i++) {
    const term = vocab[i];
    const other = vocab[(i + 1) % vocab.length];
    if (!term || !other || term.id === other.id) break;
    falsehoods.push({ text: `${term.term}: ${other.definition}`, refs: [term.id, other.id] });
  }
  if (falsehoods.length < 2) return null;
  const slide = newSlide("multiple-choice", themeId);
  const options = optionsOf(slide);
  if (options.length < 4) return null;
  const choices = [truths[0], falsehoods[0], truths[1], falsehoods[1]];
  const stem = stemOf(slide);
  replaceElement(
    slide,
    stem,
    withRefs(
      { ...stem, doc: docFromText("Which of these are true?") },
      truths.flatMap((t) => t.refs),
    ),
  );
  options.forEach((o, i) => {
    const choice = choices[i];
    if (!choice) return;
    replaceElement(slide, o, withRefs({ ...o, doc: docFromText(choice.text) }, choice.refs));
  });
  slide.question = {
    type: "multiple-choice",
    multi: true,
    options: options.map((o, i) => ({ id: o.id, correct: i % 2 === 0 })),
  };
  return slide;
}

/** Open response: the first question, its answer as the model answer. */
export function deriveOpenResponse(facts: LessonFacts, themeId: string): Slide | null {
  const q = facts.questions[0];
  if (!q) return null;
  const slide = newSlide("open-response", themeId);
  const stem = stemOf(slide);
  replaceElement(slide, stem, withRefs({ ...stem, doc: docFromText(q.stem) }, [q.id]));
  slide.question = { type: "open-response", modelAnswer: q.answer };
  return slide;
}

/* ------------------------------------------------------------------ */
/* Tier                                                                */
/* ------------------------------------------------------------------ */

const SENTENCE_STARTER = "I think the answer is … because …";
const EXPLAIN_WHY = "Explain why.";

/**
 * The tier shapes the inserted slide and is stored nowhere: Support adds a sentence starter to
 * the prompt and drops one wrong option; Challenge adds an "Explain why" line under the answers.
 * Structure slides and the discussion have no question and pass through unchanged.
 */
export function applyTier(slide: Slide, tier: ActivityTier, themeId: string): Slide {
  if (tier === "core" || !slide.question) return slide;
  const next: Slide = { ...slide, elements: [...slide.elements] };
  if (tier === "support") {
    const stem = stemOf(next);
    const prompt = docToPlainText(stem.doc).trim();
    replaceElement(next, stem, { ...stem, doc: docFromText(`${prompt}\n${SENTENCE_STARTER}`) });
    if (next.question?.type === "multiple-choice") dropOneWrongOption(next, next.question);
    return next;
  }
  const theme = getTheme(themeId);
  const h = boxH(theme, "small");
  next.elements.push(
    newText(
      "small",
      EXPLAIN_WHY,
      { x: SAFE.x, y: SAFE.y + SAFE.h - h, w: SAFE.w, h },
      {
        name: "Explain why",
        style: { preset: "small", autoHeight: true, color: theme.colors.muted },
      },
    ),
  );
  return next;
}

/** Remove the last wrong option and re-letter the rest, so Support pupils choose from one fewer. */
function dropOneWrongOption(
  slide: Slide,
  question: Extract<QuestionData, { type: "multiple-choice" }>,
) {
  const lastWrong = [...question.options].reverse().find((o) => !o.correct);
  if (!lastWrong) return;
  slide.elements = slide.elements.filter((el) => el.id !== lastWrong.id);
  const remaining = question.options.filter((o) => o.id !== lastWrong.id);
  slide.question = { ...question, options: remaining };
  let letter = 0;
  slide.elements = slide.elements.map((el) => {
    if (el.type !== "option" || !remaining.some((o) => o.id === el.id)) return el;
    const label = String.fromCharCode(65 + letter++);
    return el.label && /^[A-Z]$/.test(el.label) ? { ...el, label } : el;
  });
}

/* ------------------------------------------------------------------ */
/* Element helpers                                                     */
/* ------------------------------------------------------------------ */

/** The version stamp derived elements carry; there is no model behind them. */
export const DERIVED_PROMPT_VERSION = "derive-activities.v1";

function withRefs<T extends SlideElement>(el: T, factRefs: string[]): T {
  if (factRefs.length === 0) return el;
  return {
    ...el,
    generatedFrom: { factRefs, promptVersion: DERIVED_PROMPT_VERSION, model: "editor", at: now() },
  };
}

/** The first text element: every question recipe opens with its stem. */
function stemOf(slide: Slide): TextElement {
  const stem = slide.elements.find((el): el is TextElement => el.type === "text");
  if (!stem) throw new Error(`slide ${slide.kind} has no stem`);
  return stem;
}

function optionsOf(slide: Slide): OptionElement[] {
  return slide.elements.filter((el): el is OptionElement => el.type === "option");
}

function replaceElement(slide: Slide, from: SlideElement, to: SlideElement) {
  slide.elements = slide.elements.map((el) => (el === from ? to : el));
}

function setText(el: TextElement | OptionElement, text: string) {
  el.doc = docFromText(text);
}
