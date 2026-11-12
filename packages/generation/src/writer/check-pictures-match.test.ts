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

describe("a picture is never shown again on a check slide (y8 photosynthesis s4 and s9)", () => {
  // genlab 20261111-232340-record-e2e-y8-photosynthesis, writer output: slide 9's practice had
  // slide 4's generated micrograph lent with the neutral alt; none of its questions uses it.
  const cells: S = {
    template: "visual-text",
    fit: "points-2-fig",
    heading: "Capturing light energy",
    lead: "Photosynthesis uses light energy to make glucose.",
    points: [
      "Chloroplasts are structures inside plant cells that contain chlorophyll.",
      "Chlorophyll absorbs the light energy needed for photosynthesis.",
    ],
    figure: {
      shows: "Microscope view of leaf cells containing green chloroplasts",
      must_see: ["plant cell boundaries", "green chloroplasts"],
      subject: "generic",
    },
  };
  const apply: S = {
    template: "practice",
    heading: "Apply your learning",
    picture: null,
    items: [
      {
        question:
          "A plant needs material for new cell walls. What substance can it make from glucose?",
        answer: "Cellulose",
        working: null,
      },
      {
        question: "A plant converts glucose into starch. Explain why this is useful.",
        answer: "Starch stores energy for the plant.",
        working: null,
      },
      {
        question:
          "A leaf has no chlorophyll. Explain how this affects its ability to make glucose using light.",
        answer:
          "Without chlorophyll, the leaf cannot absorb light energy for photosynthesis and so cannot make glucose this way.",
        working: null,
      },
    ],
  };
  test("slide 9 keeps its no-picture form, logged as a repeat of slide 4", () => {
    const micrograph: VisualState = {
      status: "photo",
      photo: {
        src: "/files/x/images/01a1cced-6c3b.png",
        alt: "A microscope view of leaf cells, with clear cell boundaries and green chloroplasts visible inside them.",
        aspect: 1,
      } as never,
    };
    const slides = [undefined, undefined, undefined, cells, ...Array(4).fill(undefined), apply];
    const r = borrowCheckVisuals({
      slides,
      teaches: (i) => (i === 3 ? [1] : i === 8 ? [1, 2, 3] : []),
      state: (i) => () => (i === 3 ? micrograph : none),
      fits: () => true,
    });
    expect(r.routes).toEqual([]);
    expect(r.skips).toEqual([
      { slide: 8, template: "practice", reason: "repeat", why: "slide 4 picture already shows it" },
    ]);
  });
});

test("a photo's credits are not its numbers (y8 replay s10: gpt-image-2.5, 2026-10)", () => {
  const credited: VisualState = {
    status: "photo",
    photo: {
      src: "/files/x/images/p.png",
      alt: "Leaf cells with green chloroplasts.",
      photographer: "AI-generated (gpt-image-2.5-sunburst)",
      licence: "generated (openai-2026-10)",
      aspect: 1,
    } as never,
  };
  const teachCells: S = {
    template: "visual-text",
    heading: "Capturing light energy",
    figure: { shows: "Leaf cells with chloroplasts", subject: "generic" },
  };
  const quiz: S = {
    template: "exit-ticket",
    heading: "Exit ticket",
    items: [
      { question: "Name 2 things chloroplasts in leaf cells need.", answer: "Light and water" },
    ],
  };
  const r = borrowCheckVisuals({
    slides: [undefined, undefined, teachCells, quiz],
    teaches: () => [1],
    state: (i) => () => (i === 2 ? credited : none),
    fits: () => true,
  });
  expect(r.skips[0]?.reason).toBe("repeat");
});
