import { describe, expect, test } from "bun:test";
import type { PlanSlide } from "../prompts/plan-lesson";
import { arithmeticFaults, namesNotShown, untaughtTerms, wrongSums } from "./gates";

const row = (over: Partial<PlanSlide>): PlanSlide => ({
  role: "teach",
  objectives: [1],
  tests: [],
  teaches: [],
  purpose: "",
  parts: 0,
  form: "explain",
  layout: "default",
  imageBrief: null,
  figureBrief: null,
  ...over,
});

describe("G1 arithmetic gate", () => {
  test("a wrong sum is found, a right one passes", () => {
    expect(wrongSums("Adding 8 to both gives 3 + 8 = 13 litres.")).toEqual(["3 + 8 = 13"]);
    expect(wrongSums("One part is 10 ÷ 2 = 5, so 3 × 5 = 15 litres.")).toEqual([]);
    expect(wrongSums("thirteen = three + eight")).toEqual(["13 = 3 + 8"]);
    expect(wrongSums("£45 ÷ 5 = £9 — each part")).toEqual([]);
    expect(wrongSums("180° − 126° = 54°")).toEqual([]);
    expect(wrongSums("2/4 = 1/2 and 3/4 = 0.7")).toEqual(["3/4 = 0.7"]);
  });
  test("ratios are equal by cross-multiplying; text and dates are left alone", () => {
    expect(wrongSums("so 2:3 = 4:6 = 8:12")).toEqual([]);
    expect(wrongSums("so 2:3 = 4:5")).toEqual(["2:3 = 4:5"]);
    expect(wrongSums("Red:blue = 2:3 and the war ran 1914-1918.")).toEqual([]);
    expect(wrongSums("50% of 20 = 10")).toEqual([]);
  });
  test("the field holding a wrong sum is named for its re-write", () => {
    const f = arithmeticFaults({ question: "x", notes: "Wrong: 3 + 8 = 13." });
    expect(f.map((x) => x.field)).toEqual(["notes"]);
    expect(f[0]?.failure).toContain('"3 + 8 = 13"');
  });
});

describe("G1 taught-before-tested for practice", () => {
  const slides = [
    { number: 1, row: row({ role: "title" }), out: {} },
    { number: 2, row: row({ role: "objectives" }), out: { items: ["estuary"] } },
    {
      number: 3,
      row: row({ teaches: ["floodplain-formation", "estuary"] }),
      out: {
        heading: "Floods build a floodplain",
        body: ["Flat land: floods leave sediment."],
        notes: "An estuary is a tidal river mouth.",
      },
    },
    {
      number: 4,
      row: row({ role: "practise", form: "list", tests: ["estuary"] }),
      out: { lead: "Answer.", points: ["1: What builds a floodplain?", "2: What is an estuary?"] },
    },
  ];
  test("a term only in notes is untaught; one on a slide is taught", () => {
    expect(untaughtTerms(slides)).toEqual([{ number: 4, field: "points", terms: ["estuary"] }]);
  });
  test("once a slide shows the term, the practice item passes", () => {
    const shown = slides.map((s) =>
      s.number === 3 ? { ...s, out: { ...s.out, body: ["Estuary: a tidal river mouth."] } } : s,
    );
    expect(untaughtTerms(shown)).toEqual([]);
  });
});

describe("G1 photo caption gate", () => {
  const exempt = "The Romans in Britain The Romans in Britain";
  test("a name the photo's source does not carry is found", () => {
    const about =
      "Explore the historic cobblestone streets and preserved ruins of ancient Pompei, Italy.";
    expect(
      namesNotShown(
        "Roman remains provide evidence. At Vindolanda: The surviving stone road shows a firm surface.",
        about,
        exempt,
      ),
    ).toEqual(["Vindolanda"]);
    expect(
      namesNotShown("Roman remains. In Pompeii: The surviving stone road.", about, exempt),
    ).toEqual([]);
  });
  test("lesson-wide names and sentence openers are not claims about the photo", () => {
    expect(
      namesNotShown(
        "Homes changed. At Fishbourne: This mosaic decorated a home in Roman Britain.",
        "A mosaic in the archaelogical museum of El Jem",
        exempt,
      ),
    ).toEqual(["Fishbourne"]);
  });
});
