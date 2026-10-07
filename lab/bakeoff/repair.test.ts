import { describe, expect, test } from "bun:test";
import { armT } from "./arm-t";
import { checkSlide } from "./checks";
import { concrete, figuresOf, judgeRepair, repairable } from "./repair";
import { guarded, Ledger } from "./services";

describe("round 2 repair guards", () => {
  test("the title and objectives slides are never repaired", () => {
    expect(repairable({ template: "title", heading: "x" }, 0)).toBe(false);
    expect(repairable({ template: "objectives" }, 1)).toBe(false);
    expect(repairable({ template: "visual-text", heading: "x" }, 0)).toBe(false);
    expect(repairable({ template: "explain", heading: "x" }, 4)).toBe(true);
  });

  const compare = {
    template: "compare",
    heading: "Surface area",
    columns: [
      {
        label: "Large chips",
        text: "Less surface is exposed.",
        picture: { shows: "large marble chips" },
      },
      { label: "Powder", text: "More surface is exposed.", picture: { shows: "marble powder" } },
    ],
  };
  test("a layout switch that drops a picture is rejected (y11 s7)", () => {
    const after = {
      template: "visual-text",
      heading: "Surface area",
      points: ["Large chips: Less surface is exposed.", "Powder: More surface is exposed."],
      figure: { shows: "marble chips and powder side by side" },
    };
    const v = judgeRepair(compare, after);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.why.join(" ")).toContain("lost the picture");
  });
  test("a layout switch that keeps its figures and words is accepted", () => {
    const after = { ...compare, heading: "Surface area and rate" };
    expect(judgeRepair(compare, after).ok).toBe(true);
  });
  test("a sentence split across unlabelled compare cards is rejected (y10 s10)", () => {
    const before = {
      template: "discussion",
      heading: "Does a caring motive justify control?",
      lead: "Prospero promises Ariel freedom, threatens Caliban with 'cramps' and tells Miranda it is all for her.",
    };
    const after = {
      template: "compare",
      heading: "Does a caring motive justify control?",
      columns: [
        { label: "", text: "Prospero promises Ariel freedom, threatens Caliban with 'cramps'" },
        { label: "", text: "and tells Miranda it is all for her." },
      ],
    };
    const v = judgeRepair(before, after);
    expect(v.ok).toBe(false);
    if (!v.ok) {
      expect(v.why.some((w) => w.startsWith("empty slot"))).toBe(true);
      expect(v.why.some((w) => w.includes("split across"))).toBe(true);
    }
  });
  test("words moved to to_notes are kept; words dropped are not", () => {
    const before = {
      template: "explain",
      heading: "Rate",
      points: ["Hotter particles move faster.", "Catalysts lower the activation energy barrier."],
    };
    const after = {
      template: "explain",
      heading: "Rate",
      points: ["Hotter particles move faster."],
    };
    expect(judgeRepair(before, after, ["Catalysts lower the activation energy barrier."]).ok).toBe(
      true,
    );
    expect(judgeRepair(before, after).ok).toBe(false);
  });
  test("a repair that turns a slide into a title slide is rejected (y10 s1)", () => {
    const before = { template: "explain", heading: "Power", lead: "Prospero controls the island." };
    expect(judgeRepair(before, { ...before, template: "title" }).ok).toBe(false);
  });
  test("figures are found at any depth", () => {
    expect(figuresOf(compare).map((f) => f.shows)).toEqual(["large marble chips", "marble powder"]);
  });
});

describe("round 2 diagram failure", () => {
  test("a diagram that cannot draw is a `diagram` fault with its reasons", () => {
    const r = checkSlide({
      index: 4,
      slide: { elements: [] },
      over: [],
      diagram: ["flow does not fit its zone at a readable size"],
      questions: [],
      answers: undefined,
      notesChecked: false,
      words: "",
    });
    expect(r.faults[0]).toStartWith("diagram: figure could not be drawn:");
    expect(r.faults[0]).toContain("readable size");
  });
  test("only concrete kinds may become a picture", () => {
    expect(concrete("labelled-diagram", "a flower with its parts labelled")).toBe(true);
    expect(concrete("line-graph", "gas volume against time")).toBe(false);
    expect(concrete("labelled-diagram", "the particle model of a gas")).toBe(false);
  });
  test("asPicture turns the diagram ask into a picture ask of the same thing", () => {
    const s = armT.asPicture?.({
      template: "visual-text",
      heading: "Parts of a flower",
      points: ["Petals attract insects."],
      figure: {
        kind: "labelled-diagram",
        shows: "a flower with petals, stem and leaves",
        labels: ["petal"],
      },
    });
    expect(s?.figure).toEqual({
      shows: "a flower with petals, stem and leaves",
      // Round 8: the drawing's labels become what the picture must show.
      must_see: ["petal"],
      subject: "generic",
      ask: null,
      ask_without: null,
    });
  });
});

describe("round 2 cap guard", () => {
  const fakeGenerator = () => {
    let calls = 0;
    return {
      get calls() {
        return calls;
      },
      generate: async () => {
        calls += 1;
        return { url: "x" };
      },
    };
  };
  test("a job whose reserve does not fit is refused before it starts, without throwing", async () => {
    const ledger = new Ledger(0.1);
    ledger.add("main", 0.09);
    const g = fakeGenerator();
    const events: object[] = [];
    const r = await guarded(
      ledger,
      "picture 3:picture",
      0.025,
      () => g.generate(),
      (e) => events.push(e),
    );
    expect(r).toBeUndefined();
    expect(g.calls).toBe(0);
    expect(ledger.refused).toEqual(["picture 3:picture"]);
    expect(events[0]).toMatchObject({ ev: "cap-refused" });
  });
  test("parallel jobs see each other's holds; the third waits for a release (round 3)", async () => {
    const ledger = new Ledger(0.06);
    const g = fakeGenerator();
    let peak = 0;
    const rs = await Promise.all(
      [0, 1, 2].map(() =>
        guarded(ledger, "picture", 0.025, async () => {
          peak = Math.max(peak, ledger.committed);
          return g.generate();
        }),
      ),
    );
    expect(peak).toBeLessThanOrEqual(0.06);
    expect(g.calls).toBe(3);
    expect(rs.filter(Boolean).length).toBe(3);
    expect(ledger.refused).toEqual([]);
  });
  test("a job that throws resolves to undefined and releases its hold", async () => {
    const ledger = new Ledger(1);
    const r = await guarded(ledger, "diagram", 0.004, async () => {
      throw new Error("openai 500");
    });
    expect(r).toBeUndefined();
    expect(ledger.committed).toBe(0);
  });
});

describe("round 3: uneven compare pictures (y9 s6)", () => {
  const input = {
    template: "visual-text",
    heading: "Prices raced ahead of money",
    lead: "Hyperinflation means extremely rapid price rises: the same money buys less and less.",
    points: [
      { label: "Workers", text: "Wages could lose value before workers spent them." },
      { label: "Savers", text: "Savings in marks lost most of their buying power." },
    ],
    figure: {
      shows: "an authentic photograph of people counting German paper marks in 1923",
      must_see: [],
      subject: "named",
    },
  };
  const out = {
    template: "compare",
    heading: "Prices raced ahead of money",
    columns: [
      { label: "Hyperinflation", text: input.lead, picture: input.figure },
      {
        label: "Workers",
        text: "Wages could lose value before workers spent them.",
        picture: null,
      },
      { label: "Savers", text: "Savings in marks lost most of their buying power.", picture: null },
    ],
  };
  test("a compare with a picture in some cards only is rejected", () => {
    const v = judgeRepair(input, out);
    expect(v.ok).toBe(false);
    if (!v.ok) expect(v.why.join(" ")).toContain("1 of 3 columns have a picture");
  });
});

describe("round 3: title and objectives are structural", () => {
  test("title -> slide 1, objectives -> slide 2, slides[i] -> slide i+3, streamed", async () => {
    const { PartialJson } = await import("./partial");
    const { slideIndexer } = await import("./harness");
    const at = slideIndexer();
    const got: [number, string][] = [];
    const p = new PartialJson((path, v) => {
      const i = at(path, v);
      if (i !== undefined) got.push([i, String((v as { template?: string }).template)]);
    });
    const text = JSON.stringify({
      design: { theme: "chalk", picture_style: "photo" },
      flow: [{ slide: 1, does: "t", look_at: { kind: "none", shows: null } }],
      title: { template: "title", heading: "Fractions", lead: "x", picture: null },
      objectives: { template: "objectives" },
      slides: [{ template: "explain", heading: "a", lead: "b", points: [] }, { template: "hinge" }],
    });
    for (let k = 0; k < text.length; k += 17) p.push(text.slice(k, k + 17));
    expect(got).toEqual([
      [0, "title"],
      [1, "objectives"],
      [2, "explain"],
      [3, "hinge"],
    ]);
  });
  test("an older stream with every slide in slides keeps its indices", () => {
    const { slideIndexer } = require("./harness");
    const at = slideIndexer();
    expect(at(["objectives"], [{ teacher: "a", pupil: "b" }])).toBeUndefined();
    expect(at(["slides", 0], { template: "title" })).toBe(0);
    expect(at(["slides", 4], { template: "explain" })).toBe(4);
  });
});

describe("round 3: a diagram fault may rewrite the diagram (y11 s5)", () => {
  const before = {
    template: "visual-text",
    heading: "Increasing concentration",
    lead: "A more concentrated solution contains more reactant particles per unit volume.",
    points: [
      "Reactant particles collide more often.",
      "There are more successful collisions per second.",
    ],
    figure: {
      kind: "particles",
      shows:
        "Equal-sized solution panels with fewer and more dissolved reactant particles, using equal-length motion arrows",
      labels: ["Other particles"],
    },
  };
  const after = {
    ...before,
    figure: {
      kind: "particles",
      shows:
        "Two equal-sized panels: fewer reactant particles at low concentration, more at high concentration",
      labels: ["Low", "High"],
    },
  };
  test("rejected without the diagram fault, accepted with it", () => {
    expect(judgeRepair(before, after).ok).toBe(false);
    expect(judgeRepair(before, after, [], { diagramFault: true }).ok).toBe(true);
  });
  test("a diagram fault still may not drop the diagram", () => {
    const { figure: _, ...noFig } = after;
    expect(judgeRepair(before, noFig, [], { diagramFault: true }).ok).toBe(false);
  });
});
