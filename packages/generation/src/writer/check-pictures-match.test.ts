import { describe, expect, test } from "bun:test";
import { borrowCheckVisuals, numberClash, numbersIn } from "./check-pictures";
import type { VisualState } from "./materialise";

/*
 * 11 Nov blind review (CRITIQUE-1 items 2 and 3): the y5 fractions run
 * (genlab 20261111-232158-record-e2e-y5-fractions, writer output) lent slide 3's figure, twelve
 * counters in four groups, to the hinge "What is 1/4 of 28?", the practice on 42, 36 and 45 and the
 * exit ticket on 56 and 35. The slides below are that writer output, word for word.
 */
type S = Record<string, unknown>;

const figure: S = {
  kind: "equal-groups",
  shows: "Twelve counters shared into four equal groups.",
  alt: "Twelve counters are shared into four groups of three.",
  title: null,
  total: 12,
  groups: 4,
  layout: "rings",
  show_count: "each",
  unknown: false,
};
const teach: S = {
  template: "visual-text",
  fit: "points-2-fig",
  heading: "Find one equal part",
  lead: "The denominator tells us how many equal parts.",
  points: [
    "Divide the amount by the denominator to find one part.",
    "For example, 1/4 of 12 is 12 ÷ 4 = 3.",
  ],
  figure,
};
const hinge: S = {
  template: "hinge",
  heading: "What is 1/4 of 28?",
  options: [
    { text: "7", icon: null, why: null },
    { text: "4", icon: null, why: "This chooses the denominator instead of dividing the amount." },
    { text: "24", icon: null, why: "This subtracts the denominator instead of dividing by it." },
  ],
};
const practice: S = {
  template: "practice",
  heading: "Practise finding fractions",
  picture: null,
  items: [
    { question: "What is 1/6 of 42?", answer: "7", working: "42 ÷ 6 = 7" },
    { question: "What is 3/4 of 36?", answer: "27", working: "36 ÷ 4 × 3 = 27" },
    { question: "What is 2/5 of 45?", answer: "18", working: "45 ÷ 5 × 2 = 18" },
  ],
};
const exit: S = {
  template: "exit-ticket",
  heading: "Exit ticket",
  items: [
    { question: "What is 1/7 of 56?", answer: "8", working: "56 ÷ 7 = 8" },
    { question: "What is 4/5 of 35?", answer: "28", working: "35 ÷ 5 × 4 = 28" },
  ],
};
const drawn: VisualState = { status: "diagram", spec: { ...figure } } as never;
const none: VisualState = { status: "failed" };

describe("a lent visual's numbers are the question's (y5 fractions)", () => {
  test("numbers are read as digits and as words", () => {
    expect(
      [...numbersIn("Twelve counters in four groups; 1/4 of 28")].sort((a, b) => a - b),
    ).toEqual([1, 4, 12, 28]);
  });

  test("twelve counters beside 1/4 of 28 clash; beside 1/4 of 12 they agree", () => {
    expect(numberClash("Twelve counters in four groups", "What is 1/4 of 28? 7")).toContain("12");
    expect(numberClash("Twelve counters in four groups of three", "What is 1/4 of 12? 3")).toBe(
      undefined,
    );
    // A visual with no numbers, or only "one", never clashes.
    expect(numberClash("A leaf in sunlight", "What is 1/4 of 28?")).toBe(undefined);
    expect(numberClash("One bee on one flower", "What does the bee carry?")).toBe(undefined);
  });

  test("the recorded deck: the figure is lent to none of slides 5, 8 and 10", () => {
    const slides = [
      undefined,
      undefined,
      teach,
      undefined,
      hinge,
      undefined,
      undefined,
      practice,
      undefined,
      exit,
    ];
    const r = borrowCheckVisuals({
      slides,
      teaches: (i) => (i === 2 || i === 4 ? [1] : i === 7 || i === 9 ? [1, 2] : []),
      state: (i) => () => (i === 2 ? drawn : none),
      fits: () => true,
    });
    expect(r.routes).toEqual([]);
    for (const slide of [4, 7, 9]) {
      const skip = r.skips.find((s) => s.slide === slide);
      expect(skip?.reason).toBe("mismatch");
      expect(skip?.why).toContain("slide 3 diagram");
    }
  });
});

test("a year in a picture's words is no clash with a question that names no number", () => {
  expect(numberClash("Londoners at a fire in 1666", "How did people pass water to a fire?")).toBe(
    undefined,
  );
});
