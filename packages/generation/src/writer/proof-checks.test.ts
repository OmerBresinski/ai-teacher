import { describe, expect, test } from "bun:test";
import {
  checkReadbacks,
  itemPicturesNotOffered,
  leadingNumber,
  pointsShort,
  pointsUntaught,
  proofChecks,
  workedCaptionFault,
  workedCaptions,
  workedRestates,
} from "./proof-checks";

/* v5.2-gold BUILDER B7: the proof's counts, logged only. Cases from the 11 Nov Year 5 run. */

const RESTATED = {
  template: "worked",
  heading: "Find 1/3 of 21.",
  lines: [
    { move: "Divide by the denominator.", eq: "21 ÷ 3 = 7", answer: false },
    { move: "State the fraction found.", eq: "1/3 of 21 = 7", answer: true },
  ],
};
const CLEAN = {
  template: "worked",
  heading: "Find 3/5 of 40.",
  lines: [
    { move: "Divide by the denominator.", eq: "40 ÷ 5 = 8", answer: false },
    { move: "Multiply by the numerator.", eq: "8 × 3 = 24", answer: true },
  ],
};

describe("workedRestates", () => {
  test("a closing row that restates the problem and the last result counts", () =>
    expect(workedRestates(RESTATED)).toBe(1));
  test("rows that each make a move do not", () => expect(workedRestates(CLEAN)).toBe(0));
  test("other slides count nothing", () =>
    expect(workedRestates({ template: "explain", lines: RESTATED.lines })).toBe(0));
});

describe("proofChecks", () => {
  test("flow against the range, restates over the deck, exit items against objectives", () => {
    const exit = { template: "exit-ticket", items: [{ question: "a" }, { question: "b" }] };
    expect(
      proofChecks(
        { flow: new Array(10).fill({}), slides: [RESTATED, CLEAN, RESTATED, exit] },
        { min: 10, max: 12 },
        3,
      ),
    ).toEqual({
      flowCount: { planned: 10, min: 10, max: 12 },
      workedRestate: 2,
      exitObjectives: { questions: 2, objectives: 3 },
      pointsUntaught: null,
      workedCaption: [],
      checkReadback: [],
      itemPictures: [],
      pointsShort: null,
    });
  });
  test("no exit ticket on the slides: null", () =>
    expect(proofChecks({ slides: [CLEAN] }, { min: 9, max: 12 }, 2).exitObjectives).toBeNull());
});

/* v5.3-gold: cases from the 12 Nov runs (scratchpad/tuning/v5.3-gold/DIAGNOSIS.md). */

describe("a worked row's move against its own line", () => {
  test("the 12 Nov Year 5 rows: the move names a fraction the line does not multiply by", () => {
    expect(workedCaptionFault("Multiply by three quarters.", "2 1/2 × 3 = 7 1/2")).toBe(
      "the move names 0.75; the line works with 2.5, 3",
    );
    expect(workedCaptionFault("Multiply by three fifths.", "1 2/5 × 3 = 4 1/5")).toContain("0.6");
  });
  test("a move that names the line's own number passes, in digits or words", () => {
    expect(workedCaptionFault("Multiply by 3.", "2 1/2 × 3 = 7 1/2")).toBeUndefined();
    expect(workedCaptionFault("Multiply by three.", "2 1/2 × 3 = 7 1/2")).toBeUndefined();
    expect(workedCaptionFault("Divide by 4.", "10 ÷ 4 = 2 1/2")).toBeUndefined();
    expect(workedCaptionFault("Subtract 5 1/3.", "7 3/3 − 5 1/3 = 2 2/3 m")).toBeUndefined();
    expect(workedCaptionFault("Multiply by a half.", "8 × 1/2 = 4")).toBeUndefined();
  });
  test("the verb must be the line's operation", () => {
    expect(workedCaptionFault("Multiply by 3.", "10 ÷ 4 = 2 1/2")).toBe(
      "the move says multiply; the line has no ×",
    );
    expect(
      workedCaptionFault("Subtract the length used.", "7 3/3 - 5 1/3 = 2 2/3 m"),
    ).toBeUndefined();
  });
  test("a move in other words is not read", () => {
    expect(workedCaptionFault("Find one equal quarter.", "10 ÷ 4 = 2 1/2")).toBeUndefined();
    expect(workedCaptionFault("Divide by the denominator.", "21 ÷ 3 = 7")).toBeUndefined();
    expect(workedCaptionFault("Add the two parts.", "3 + 4 = 7")).toBeUndefined();
    expect(workedCaptionFault(null, "3 + 4 = 7")).toBeUndefined();
  });
  test("leadingNumber reads digits, words and fraction words", () => {
    expect(leadingNumber("2 1/2")).toBe(2.5);
    expect(leadingNumber("three quarters.")).toBe(0.75);
    expect(leadingNumber("one half")).toBe(0.5);
    expect(leadingNumber("halves")).toBe(0.5);
    expect(leadingNumber("twelve")).toBe(12);
    expect(leadingNumber("the numerator")).toBeUndefined();
    expect(leadingNumber("a number")).toBeUndefined();
  });
  test("workedCaptions numbers slides from the deck's slide 3", () => {
    const slides = [
      { template: "hinge", heading: "?" },
      {
        template: "worked",
        heading: "Find 3/4 of 10.",
        lines: [
          { eq: "10 ÷ 4 = 2 1/2", move: "Find one equal quarter.", answer: false },
          { eq: "2 1/2 × 3 = 7 1/2", move: "Multiply by three quarters.", answer: true },
        ],
      },
    ];
    expect(workedCaptions(slides)).toEqual([
      {
        slide: 4,
        move: "Multiply by three quarters.",
        eq: "2 1/2 × 3 = 7 1/2",
        why: "the move names 0.75; the line works with 2.5, 3",
      },
    ]);
  });
});

describe("every point has a teaching slide", () => {
  const flow = [
    { slide: 1, layout: "title", points: [] },
    { slide: 3, layout: "visual-text points-2-fig", points: ["1a"] },
    { slide: 4, layout: "hinge", points: ["1b"] },
    { slide: 5, layout: "worked", points: ["1B", " 2a "] },
    { slide: 6, layout: "practice" },
  ];
  test("a label only a check lists is untaught; case and spaces do not matter", () => {
    expect(pointsUntaught(flow, ["1a", "1b", "2a", "2b"])).toEqual(["2b"]);
    expect(pointsUntaught(flow.slice(0, 3), ["1a", "1b"])).toEqual(["1b"]);
  });
  test("no points: null", () => {
    expect(pointsUntaught(flow, [])).toBeNull();
    expect(proofChecks({ flow, slides: [] }, { min: 10, max: 12 }, 2).pointsUntaught).toBeNull();
    expect(
      proofChecks({ flow, slides: [] }, { min: 10, max: 12 }, 2, ["1a", "2b"]).pointsUntaught,
    ).toEqual(["2b"]);
  });
});

describe("a check that brings no new case", () => {
  const taught = {
    template: "reasons",
    heading: "Why did it spread?",
    items: [
      { head: "Wooden houses", line: "Wood burns, so houses caught fire.", icon: null },
      { head: "Narrow streets", line: "Flames could reach houses across small gaps.", icon: null },
      { head: "Strong wind", line: "Wind blew flames towards other houses.", icon: "wind" },
    ],
    picture: null,
  };
  test("the 12 Nov Year 2 hinge reads the last slide back", () => {
    const hinge = {
      template: "hinge",
      heading: "What could wind blow towards houses?",
      options: [
        { text: "Flames from a fire.", icon: null, why: null },
        {
          text: "Water from a bucket.",
          icon: null,
          why: "The pupil confuses spreading fire with fighting it.",
        },
      ],
    };
    expect(checkReadbacks([taught, hinge])).toEqual([
      {
        slide: 4,
        question: "What could wind blow towards houses? Flames from a fire.",
        share: 0.8,
      },
    ]);
  });
  test("a question on a new case is not flagged; a wrong option's words never count as shown", () => {
    const practice = {
      template: "practice",
      heading: "Think about spread",
      items: [
        {
          question: "A baker leaves a candle beside straw in a barn. What could happen next?",
          answer: "The straw could catch fire and the barn could burn.",
          working: null,
        },
      ],
    };
    expect(checkReadbacks([taught, practice])).toEqual([]);
  });
});

describe("itemPicturesNotOffered (v5.3-gold B4)", () => {
  const pic = { shows: "a leaf", must_see: [] };
  const items = (k: number, withPic = true) =>
    Array.from({ length: k }, (_, i) => ({
      name: `N${i}`,
      text: "t",
      picture: withPic ? pic : null,
    }));
  test("four pictured items where pictures are offered for 2 to 3 is found", () => {
    const slides = [{ template: "title" }, { template: "panel-list", items: items(4) }];
    expect(itemPicturesNotOffered(slides, [2, 3])).toEqual([
      { slide: 2, items: 4, offered: [2, 3] },
    ]);
  });
  test("an offered count, items without pictures, or no offer table: nothing", () => {
    expect(itemPicturesNotOffered([{ template: "panel-list", items: items(3) }], [2, 3])).toEqual(
      [],
    );
    expect(
      itemPicturesNotOffered([{ template: "panel-list", items: items(4, false) }], [2, 3]),
    ).toEqual([]);
    expect(
      itemPicturesNotOffered([{ template: "panel-list", items: items(4) }], undefined),
    ).toEqual([]);
  });
});

describe("pointsShort (v5.3-gold B5)", () => {
  test("five points for a Detailed 13 to 16 lesson is short of six", () => {
    expect(pointsShort(5, { min: 13, max: 16 })).toEqual({ points: 5, lo: 6 });
  });
  test("five points for Standard, or no points, is not", () => {
    expect(pointsShort(5, { min: 11, max: 12 })).toBeNull();
    expect(pointsShort(0, { min: 13, max: 16 })).toBeNull();
  });
});
