import { describe, expect, test } from "bun:test";
import {
  answerRevealSteps,
  type LessonFacts,
  LessonSchema,
  type OptionElement,
  type Slide,
  SlideSchema,
  type TextElement,
} from "@tj/domain/documents";
import { docToPlainText } from "../text/static";
import {
  ACTIVITY_GROUPS,
  ACTIVITY_TIERS,
  applyTier,
  buildActivity,
  deriveFillGap,
  deriveMatching,
  deriveMultipleChoice,
  deriveOpenResponse,
  deriveSort,
  deriveTrueFalse,
  deriveWhichAreTrue,
  fixtureActivity,
  slideFactRefs,
} from "./derive-activities";
import { newLesson } from "./factories";

/* TEACH-185: every derivation, the fixture fallback and the tier shaping. */

const THEME = "chalk";

/** A small water-cycle fact set; `demo-facts.ts` (TEACH-183) is not this file's to rely on. */
const FACTS: LessonFacts = {
  objectives: [{ id: "o1", text: "Describe the stages of the water cycle" }],
  vocabulary: [
    { id: "v1", term: "Evaporation", definition: "Liquid water turning into vapour" },
    { id: "v2", term: "Condensation", definition: "Vapour turning back into liquid water" },
    { id: "v3", term: "Precipitation", definition: "Water falling from clouds as rain or snow" },
    { id: "v4", term: "Collection", definition: "Water gathering in rivers, lakes and seas" },
    { id: "v5", term: "Transpiration", definition: "Plants releasing vapour from their leaves" },
  ],
  workedExamples: [
    {
      id: "x1",
      problem: "Why does a cold can sweat?",
      steps: ["Air near the can cools", "Vapour condenses on it"],
      answer: "Condensation on the cold surface",
    },
  ],
  questions: [
    {
      id: "q1",
      stem: "Which process turns liquid water into vapour?",
      answer: "Evaporation",
      reasoning: "Heat gives the molecules energy to escape",
    },
    {
      id: "q2",
      stem: "Where does condensation happen?",
      answer: "On cold surfaces",
      reasoning: "Vapour loses energy where it is cold",
    },
  ],
  misconceptions: [
    { id: "m1", belief: "Clouds are made of steam", correction: "", objectiveRefs: [] },
    { id: "m2", belief: "Water disappears when it evaporates", correction: "", objectiveRefs: [] },
    { id: "m3", belief: "Rain comes straight from the sea", correction: "", objectiveRefs: [] },
  ],
  outline: [
    { id: "s1", kind: "starter", minutes: 5, factRefs: ["o1"] },
    { id: "s2", kind: "vocabulary", minutes: 10, factRefs: ["v1", "v2"] },
    { id: "s3", kind: "multiple-choice", minutes: 5, factRefs: ["q1"] },
    { id: "s4", kind: "exit-ticket", minutes: 5, factRefs: ["q2"] },
  ],
  durationMin: 25,
};

const texts = (slide: Slide) =>
  slide.elements.filter((el): el is TextElement => el.type === "text").map((el) => plain(el));
const options = (slide: Slide) =>
  slide.elements.filter((el): el is OptionElement => el.type === "option");
const plain = (el: { doc: TextElement["doc"] }) => docToPlainText(el.doc).trim();

describe("derive-activities", () => {
  test("matching takes the first four vocabulary pairs and deranges the definitions", () => {
    const slide = deriveMatching(FACTS, THEME);
    if (slide?.question?.type !== "matching") throw new Error("no matching slide");
    expect(texts(slide).slice(1, 5)).toEqual([
      "Evaporation",
      "Condensation",
      "Precipitation",
      "Collection",
    ]);
    expect(slide.question.pairs).toHaveLength(4);
    for (const pair of slide.question.pairs) {
      const left = slide.elements.find((el) => el.id === pair.leftElementId) as TextElement;
      const right = slide.elements.find((el) => el.id === pair.rightElementId) as TextElement;
      const vocab = FACTS.vocabulary.find((v) => v.term === plain(left));
      expect(plain(right)).toBe(vocab?.definition ?? "");
      // No definition sits level with its own term.
      expect(right.y).not.toBe(left.y);
    }
    expect(slideFactRefs(slide)).toEqual(["v1", "v2", "v3", "v4"]);
    expect(
      deriveMatching({ ...FACTS, vocabulary: FACTS.vocabulary.slice(0, 1) }, THEME),
    ).toBeNull();
  });

  test("fill the gap blanks the term in each of the first two definitions", () => {
    const slide = deriveFillGap(FACTS, THEME);
    if (slide?.question?.type !== "fill-gap") throw new Error("no fill-gap slide");
    const gap = slide.elements.find((el) => el.type === "gap-text");
    const text = gap && "doc" in gap ? docToPlainText(gap.doc) : "";
    expect(slide.question.gaps.map((g) => g.answer)).toEqual(["Evaporation", "Condensation"]);
    for (const g of slide.question.gaps) expect(text).toContain(`[[gap:${g.id}]]`);
    expect(text).toContain("Liquid water turning into vapour");
    expect(slideFactRefs(slide)).toEqual(["v1", "v2"]);
  });

  test("sort follows the outline order, names each card by its fact and shuffles the slots", () => {
    const slide = deriveSort(FACTS, THEME);
    if (slide?.question?.type !== "sort") throw new Error("no sort slide");
    const cards = options(slide);
    expect(cards.map(plain)).toEqual([
      "Describe the stages of the water cycle",
      "Evaporation",
      "Which process turns liquid water into vapour?",
      "Where does condensation happen?",
    ]);
    expect(slide.question.order).toEqual(cards.map((c) => c.id));
    // Reading order on the slide is not the answer.
    const byPosition = [...cards].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => c.id);
    expect(byPosition).not.toEqual(slide.question.order);
    expect(slideFactRefs(slide)).toEqual(["o1", "v1", "v2", "q1", "q2"]);
  });

  test("true or false states a misconception as false, or a definition as true", () => {
    const slide = deriveTrueFalse(FACTS, THEME);
    expect(slide && texts(slide)[0]).toBe("Clouds are made of steam");
    expect(slide?.question).toEqual({ type: "true-false", correct: false });
    expect(slide && slideFactRefs(slide)).toEqual(["m1"]);
    const noMisconceptions = deriveTrueFalse({ ...FACTS, misconceptions: [] }, THEME);
    expect(noMisconceptions && texts(noMisconceptions)[0]).toBe(
      "Evaporation: Liquid water turning into vapour",
    );
    expect(noMisconceptions?.question).toEqual({ type: "true-false", correct: true });
    expect(deriveTrueFalse({ ...FACTS, misconceptions: [], vocabulary: [] }, THEME)).toBeNull();
  });

  test("multiple choice asks the first question with three misconceptions as distractors", () => {
    const slide = deriveMultipleChoice(FACTS, THEME);
    if (slide?.question?.type !== "multiple-choice") throw new Error("no mc slide");
    expect(texts(slide)[0]).toBe("Which process turns liquid water into vapour?");
    const cards = options(slide);
    expect(cards).toHaveLength(4);
    const correct = slide.question.options.filter((o) => o.correct);
    expect(correct).toHaveLength(1);
    expect(plain(cards.find((c) => c.id === correct[0]?.id) as OptionElement)).toBe("Evaporation");
    const wrong = cards.filter((c) => c.id !== correct[0]?.id).map(plain);
    expect(wrong.sort()).toEqual(
      [
        "Clouds are made of steam",
        "Water disappears when it evaporates",
        "Rain comes straight from the sea",
      ].sort(),
    );
    expect(slideFactRefs(slide).sort()).toEqual(["m1", "m2", "m3", "q1"]);
    expect(answerRevealSteps(slide)).toBe(4);
    // Too few misconceptions: other answers, then terms, then a stock line fill the cards.
    const thin = deriveMultipleChoice(
      { ...FACTS, misconceptions: [], questions: FACTS.questions.slice(0, 1), vocabulary: [] },
      THEME,
    );
    expect(thin && options(thin).map(plain)).toContain("None of these");
  });

  test("which are true is multi with two definitions true and two false statements", () => {
    const slide = deriveWhichAreTrue(FACTS, THEME);
    if (slide?.question?.type !== "multiple-choice") throw new Error("no slide");
    expect(slide.question.multi).toBe(true);
    expect(texts(slide)[0]).toBe("Which of these are true?");
    const cards = options(slide);
    const truths = slide.question.options.filter((o) => o.correct).map((o) => o.id);
    expect(truths).toHaveLength(2);
    expect(cards.filter((c) => truths.includes(c.id)).map(plain)).toEqual([
      "Evaporation: Liquid water turning into vapour",
      "Condensation: Vapour turning back into liquid water",
    ]);
    expect(cards.filter((c) => !truths.includes(c.id)).map(plain)).toEqual([
      "Clouds are made of steam",
      "Water disappears when it evaporates",
    ]);
    // Without misconceptions a term paired with another's definition is the false statement.
    const swapped = deriveWhichAreTrue({ ...FACTS, misconceptions: [] }, THEME);
    expect(swapped && options(swapped).map(plain)[1]).toBe(
      "Evaporation: Vapour turning back into liquid water",
    );
  });

  test("open response asks the first question with its answer as the model answer", () => {
    const slide = deriveOpenResponse(FACTS, THEME);
    expect(slide && texts(slide)[0]).toBe("Which process turns liquid water into vapour?");
    expect(slide?.question).toEqual({ type: "open-response", modelAnswer: "Evaporation" });
    expect(slide && slideFactRefs(slide)).toEqual(["q1"]);
  });

  test("without facts every card is the layouts fixture; Which are true is multi with two right", () => {
    const matching = buildActivity("matching", THEME);
    expect(texts(matching).slice(1)).toEqual([
      "Term 1",
      "Term 2",
      "Term 3",
      "Definition 1",
      "Definition 2",
      "Definition 3",
    ]);
    expect(slideFactRefs(matching)).toEqual([]);
    const which = buildActivity("which-are-true", THEME);
    expect(which.kind).toBe("multiple-choice");
    if (which.question?.type !== "multiple-choice") throw new Error("no question");
    expect(which.question.multi).toBe(true);
    expect(which.question.options.filter((o) => o.correct)).toHaveLength(2);
    // Every card in every group builds.
    for (const group of ACTIVITY_GROUPS)
      for (const id of group.activities)
        expect(buildActivity(id, THEME).elements.length).toBeGreaterThan(0);
    expect(fixtureActivity("do-now", THEME).kind).toBe("starter");
  });

  test("Support adds a sentence starter and drops one wrong option; Challenge adds Explain why", () => {
    const support = buildActivity("multiple-choice", THEME, { facts: FACTS, tier: "support" });
    expect(texts(support)[0]).toContain("I think the answer is");
    const cards = options(support);
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.label)).toEqual(["A", "B", "C"]);
    if (support.question?.type !== "multiple-choice") throw new Error("no question");
    expect(support.question.options).toHaveLength(3);
    expect(support.question.options.filter((o) => o.correct)).toHaveLength(1);

    const challenge = buildActivity("multiple-choice", THEME, { facts: FACTS, tier: "challenge" });
    expect(options(challenge)).toHaveLength(4);
    const last = challenge.elements[challenge.elements.length - 1] as TextElement;
    expect(plain(last)).toBe("Explain why.");
    // Core is the slide as derived; structure slides ignore the tier.
    expect(buildActivity("multiple-choice", THEME, { facts: FACTS }).elements).toHaveLength(5);
    const timer = buildActivity("timer", THEME, { tier: "challenge" });
    expect(applyTier(timer, "support", THEME)).toBe(timer);
    expect(timer.elements.some((el) => el.type === "text" && plain(el) === "Explain why.")).toBe(
      false,
    );
  });

  test("every derived slide, at every tier, parses as a Slide and together as a Lesson", () => {
    const slides: Slide[] = [];
    for (const group of ACTIVITY_GROUPS)
      for (const id of group.activities)
        for (const { value: tier } of ACTIVITY_TIERS) {
          const slide = buildActivity(id, THEME, { facts: FACTS, tier });
          const parsed = SlideSchema.safeParse(slide);
          expect(parsed.success, `${id} / ${tier}: ${parsed.error?.message ?? ""}`).toBe(true);
          slides.push(slide);
        }
    const lesson = { ...newLesson("Round trip", THEME), slides, facts: FACTS };
    const parsed = LessonSchema.safeParse(lesson);
    expect(parsed.success, parsed.error?.message ?? "").toBe(true);
  });
});
