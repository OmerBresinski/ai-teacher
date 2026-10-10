import { afterAll, describe, expect, test } from "bun:test";
import { buildCount, svgOfDataUrl } from "@tj/slides/diagram-builds";
import {
  derivable,
  drawingWordsMismatch,
  drawnTexts,
  fractionsNamed,
  quantities,
  statedCounts,
  wordValue,
} from "./consistency";
import { capabilityRefusals, checkParams, fillSchema, libraryDiagram } from "./fill";
import { endDrawThread } from "./guard";
import { boundsRefusals, kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part i: a library drawing never contradicts the words that describe it (the slide's
 * heading and the model's caption). The wrong cases are prod-lib-1's (scratchpad/ab-prodlib/NOTES.md):
 * the fills are the saved Luna outputs, the words the slides'.
 */
const draw = async (id: string, sent: J, preset?: number) => {
  const m = await loadModel(id);
  const base = preset === undefined ? {} : (m?.presets[preset]?.params ?? {});
  const P = (await kit()).withDefaults(m?.params ?? { properties: {} }, { ...base, ...sent });
  return (await renderLibraryModel(id, P)).svg;
};
const svgOf = (...texts: string[]) =>
  `<svg>${texts.map((t) => `<text>${t}</text>`).join("")}</svg>`;

const HALF_OF_16 = "Find one half of 16\nDraw two equal groups. Find how many are in one group.";
const QUARTER_OF_16 =
  "Find one quarter of 16\nDraw four equal groups. Find how many are in one group.";
const THREE_FIFTHS = "Three fifths of 20\nEach fifth is 4. Three fifths is three groups of 4.";
const EQUAL_PARTS =
  "Equal parts\nOne half: one of two equal parts. One quarter: one of four equal parts.";
const HALF_OF_12 =
  "Find one half of 12\nShare into two equal groups. One group has 6: one half of 12 is 6.";

describe("reading numbers", () => {
  test("number words: compounds, tens, hundred and one", () => {
    expect(wordValue("twenty-five")).toBe(25);
    expect(wordValue("ninety")).toBe(90);
    expect(wordValue("two hundred and five")).toBe(205);
    expect(wordValue("one")).toBe(1);
    expect(quantities("thirty-six counters")).toEqual([{ v: 36 }]);
  });

  test("money and units: 20p is £0.20, 150 cm is 1.5 m, and kinds must agree", () => {
    expect(quantities("20p")).toEqual([{ v: 0.2, unit: "£" }]);
    expect(quantities("£0.20")).toEqual([{ v: 0.2, unit: "£" }]);
    expect(quantities("150 cm")[0]?.v).toBeCloseTo(1.5);
    // half of 20 m drawn as 20 kg: the same value, a different kind
    expect(
      drawingWordsMismatch("measuring_scales", svgOf("20 kg ÷ 2 = 10 kg"), "Half of 20 m"),
    ).toBeDefined();
    expect(
      drawingWordsMismatch("measuring_scales", svgOf("2,000 cm ÷ 2 = 10 m"), "Half of 20 m"),
    ).toBeUndefined();
    expect(
      drawingWordsMismatch("coins_money", svgOf("£0.40 ÷ 2 = 20p"), "Find half of 40p"),
    ).toBeUndefined();
  });

  test("fractions: digits, vulgar, words; tenths match their decimal", () => {
    expect(fractionsNamed("Three fifths of 20")).toEqual([{ n: 3, d: 5 }]);
    expect(fractionsNamed("¾ and 2/5")).toEqual([
      { n: 2, d: 5 },
      { n: 3, d: 4 },
    ]);
    expect(fractionsNamed("the third group")).toEqual([]);
    expect(drawingWordsMismatch("fractions", svgOf("0.3"), "Three tenths")).toBeUndefined();
    expect(derivable("Three fifths of 20").some((q) => q.v === 12)).toBe(true);
  });

  test("a drawing's text is read with tspans joined and entities decoded", () => {
    expect(drawnTexts('<svg><text x="1"><tspan>16</tspan>&#160;÷ 2 = 8</text></svg>')).toEqual([
      "16 ÷ 2 = 8",
    ]);
  });
});

describe("the four wrong-number slides of prod-lib-1 are refused", () => {
  test("y2 s7: the default group size drew 4 ÷ 2 = 2 for one half of 16", async () => {
    const svg = await draw("equal_groups", {
      layout: "groups",
      groups: 2,
      object: "counter",
      division: "sharing",
    });
    expect(drawingWordsMismatch("equal_groups", svg, HALF_OF_16)).toContain("16");
  });

  test("y2 s9: 8 ÷ 4 = 2 for one quarter of 16", async () => {
    const svg = await draw("equal_groups", { groups: 4, division: "sharing", countSteps: false });
    expect(drawingWordsMismatch("equal_groups", svg, QUARTER_OF_16)).toBeDefined();
  });

  test("y5 s6: all five groups and 5 × 4 = 20 never show three fifths", async () => {
    const svg = await draw("equal_groups", { groups: 5, size: 4, division: "none" });
    expect(drawingWordsMismatch("equal_groups", svg, THREE_FIFTHS)).toContain("3/5");
  });

  test("y2 s3: a 'show' of 1/2 and 1/4 draws one half only; the caption names a quarter", async () => {
    const svg = await draw("fractions", {
      operation: "show",
      representation: "rectangle",
      fractions: [{ value: "1/2" }, { value: "1/4" }],
      words: true,
    });
    expect(drawingWordsMismatch("fractions", svg, EQUAL_PARTS)).toContain("1/4");
  });

  test("y2 s10: words that name A, B and C need them drawn, on any model", async () => {
    const svg = await draw("fractions", { fractions: [{ value: "1/2" }], words: false });
    const about = "Name the shaded fraction\nWrite half or quarter for A, B and C.";
    expect(drawingWordsMismatch("fractions", svg, about)).toContain("A, B, C");
    expect(drawingWordsMismatch("timeline", svgOf("AD 43"), about)).toContain("A, B, C");
  });

  test("a sum built from a number the words neither give nor work out is refused", () => {
    expect(drawingWordsMismatch("equal_groups", svgOf("16", "4 ÷ 2 = 2"), HALF_OF_16)).toContain(
      "neither given nor worked out",
    );
  });

  test("a drawn sum that is wrong is refused, whatever its terms", () => {
    expect(
      drawingWordsMismatch("equal_groups", svgOf("12 ÷ 4 = 4"), "Find one quarter of 12"),
    ).toContain("wrong");
  });
});

describe("right drawings pass: contradiction refuses, absence does not", () => {
  test("y2 s6 half of 12, y2 s8 quarter of 12, y5 s3 one fifth of 20", async () => {
    const half = await draw("equal_groups", { groups: 2, size: 6, division: "sharing" });
    expect(drawingWordsMismatch("equal_groups", half, HALF_OF_12)).toBeUndefined();
    const quarter = await draw("equal_groups", { groups: 4, size: 3, division: "sharing" });
    expect(
      drawingWordsMismatch(
        "equal_groups",
        quarter,
        "Find one quarter of 12\nShare into four equal groups. One group has 3: one quarter of 12 is 3.",
      ),
    ).toBeUndefined();
    const fifth = await draw("equal_groups", { groups: 5, size: 4, division: "sharing" });
    expect(
      drawingWordsMismatch(
        "equal_groups",
        fifth,
        "One fifth of 20\nThe denominator, 5, makes five equal parts. One part is 4.",
      ),
    ).toBeUndefined();
  });

  test("a worked sum whose terms follow from the words: 8 + 8 = 16 for one half of 16", async () => {
    expect(
      drawingWordsMismatch("equal_groups", svgOf("16 ÷ 2 = 8", "8 + 8 = 16"), HALF_OF_16),
    ).toBeUndefined();
    const right = await draw("equal_groups", { groups: 2, size: 8, division: "sharing" });
    expect(drawingWordsMismatch("equal_groups", right, HALF_OF_16)).toBeUndefined();
  });

  test("three fifths of 20 drawn by fractions (of, set) passes", async () => {
    const svg = await draw("fractions", {
      operation: "of",
      representation: "set",
      fractions: [{ value: "3/5" }],
      amount: 20,
    });
    expect(drawingWordsMismatch("fractions", svg, THREE_FIFTHS)).toBeUndefined();
  });

  test("real prose slides on non-number models pass (lib-wo1 y4 history, y6 geography; prod-lib-1 y11)", async () => {
    const timeline = await draw("timeline", {}, 0);
    expect(
      drawingWordsMismatch(
        "timeline",
        timeline,
        "Three Roman arrivals\nCaesar came twice. Much later, Claudius ordered an invasion that began Roman rule.",
      ),
    ).toBeUndefined();
    const map = await draw("hist_map", {}, 1);
    expect(
      drawingWordsMismatch(
        "hist_map",
        map,
        "Where is the Amazon rainforest?\nPredict: will plants near the ground receive as much sunlight as the tallest trees?",
      ),
    ).toBeUndefined();
    const collisions = await draw("collision_theory", {
      factors: ["concentration"],
      reactantA: "hydrochloric acid",
      reactantB: "magnesium",
      showCounter: true,
    });
    expect(
      drawingWordsMismatch(
        "collision_theory",
        collisions,
        "More particles in the same volume\nMore frequent successful collisions mean a faster reaction.",
      ),
    ).toBeUndefined();
  });
});

describe("a number the drawing is built from is never defaulted", () => {
  test("y2 s7's saved fill (no size) goes to the drawer, after one repair, never to size 2", async () => {
    const saved = { layout: "groups", groups: 2, object: "counter", division: "sharing" };
    const users: string[] = [];
    const r = await libraryDiagram(
      {
        key: "diagram",
        model: "equal_groups",
        intent: "Question: show sixteen ungrouped counters and two empty rings.",
        words: HALF_OF_16,
        heading: "Find one half of 16",
        caption: "Draw two equal groups. Find how many are in one group.",
        yearGroup: "Year 2",
        lesson: "Maths: halves",
      },
      async (req) => {
        users.push(req.user);
        return saved;
      },
    );
    expect(r).toMatchObject({ ok: false, fallbackKind: "equal-groups" });
    if (!r.ok) expect(r.reason).toContain("size is missing");
    expect(users.length).toBe(2);
  });

  test("the filler's schema requires the always-needed ones; checkParams refuses the rest", async () => {
    const m = await loadModel("fractions");
    expect(
      (fillSchema(m?.params ?? {}, "fractions") as { required?: string[] }).required,
    ).toContain("fractions");
    const of = await checkParams("fractions", { operation: "of", fractions: [{ value: "3/5" }] });
    expect(of.refusals.map((x) => x.path)).toEqual(["amount"]);
    const ok = await checkParams("equal_groups", { groups: 2, size: 8, division: "sharing" });
    expect(ok.params).toBeDefined();
  });

  test("y5 s6's intent ('Highlight three complete rings') is one equal_groups cannot draw", () => {
    const intent =
      "Show the same 20 counters in five equal rings of four. Highlight three complete rings with one colour and leave two unselected. Identify the selected fraction as 3/5.";
    expect(capabilityRefusals("equal_groups", intent).length).toBeGreaterThan(0);
    expect(
      capabilityRefusals("equal_groups", "Show 20 counters shared into five equal rings."),
    ).toEqual([]);
  });
});

describe("params out of bounds are refused, never clamped", () => {
  test("a number or text past its bounds is a refusal naming the path", () => {
    const schema = {
      type: "object",
      properties: { n: { type: "integer", maximum: 12 }, free: { type: "number" } },
    };
    expect(boundsRefusals(schema, { n: 16 })[0]?.path).toBe("n");
    expect(boundsRefusals(schema, { free: -1e12 })[0]?.path).toBe("free");
    expect(boundsRefusals(schema, { n: 12, free: 3 })).toEqual([]);
  });

  test("checkParams refuses a value a clamp would change", async () => {
    expect((await checkParams("fractions", { whole: "x".repeat(61) })).params).toBeUndefined();
    expect((await checkParams("equal_groups", { groups: 16, size: 2 })).params).toBeUndefined();
  });

  test("the draw itself refuses out-of-bounds params", async () => {
    await expect(renderLibraryModel("equal_groups", { groups: 1e9 })).rejects.toThrow(
      /out of range/,
    );
  });
});

describe("Present never opens a library model on an empty box", () => {
  test("a drawing plays builds from an opening frame that is not empty (TEACH-247 part p)", async () => {
    const m = await loadModel("fractions");
    const r = await renderLibraryModel(
      "fractions",
      (await kit()).withDefaults(m?.params ?? { properties: {} }, {}),
    );
    expect(r.builds).toBeGreaterThan(0);
    expect(buildCount(svgOfDataUrl(r.src) ?? "")).toBe(r.builds);
    // The opening frame: every mark without a build (the whole pizza and its label).
    const opening = r.svg.replace(/<g data-s="\d+">[\s\S]*?<\/g>/g, "");
    expect(opening).toContain("<text");
  });
});

afterAll(() => endDrawThread());

describe("S10 paid L y2 s6: the counts the words state are drawn", () => {
  const SHARE_12 = "Share 12 equally\nOne half is 6. One quarter is 3.";
  test("a bar comparison that never shows 12, 6 or 3 is refused for a sharing slide", async () => {
    // The recorded fill: compare, set, 12 counters. Set cannot compare, so the model drew bars.
    const svg = await draw("fractions", {
      operation: "compare",
      representation: "set",
      fractions: [{ value: "1/2" }, { value: "1/4" }],
      whole: "12 counters",
      amount: 12,
      things: "counters",
      words: true,
    });
    expect(drawingWordsMismatch("fractions", svg, SHARE_12)).toContain("12");
  });
  test("equal groups that show the counts pass; fraction names alone need no count", async () => {
    const half = await draw("equal_groups", { groups: 2, size: 6, division: "sharing" });
    expect(
      drawingWordsMismatch("equal_groups", half, "Share 12 equally\nOne half is 6."),
    ).toBeUndefined();
    const bars = await draw("fractions", {
      operation: "compare",
      representation: "bar",
      fractions: [{ value: "1/2" }, { value: "1/4" }],
    });
    expect(
      drawingWordsMismatch(
        "fractions",
        bars,
        "One half and one quarter\nEqual parts are the same size.",
      ),
    ).toBeUndefined();
  });
});

describe("S10 paid L y2 s9: an equivalence draws the finer parts with the coarser marked", () => {
  /** The distinct cut lines across a bar (vertical paths) in a drawn SVG. */
  const cuts = (svg: string) =>
    new Set([...svg.matchAll(/<path d="M([\d.]+) [\d.]+ V[\d.]+"/g)].map((m) => m[1])).size;
  test("2/4 = 1/2 (finer first, as the fill sent it) shows all three quarter cuts", async () => {
    for (const fractions of [
      [{ value: "2/4" }, { value: "1/2" }],
      [{ value: "1/2" }, { value: "2/4" }],
    ]) {
      const c = await checkParams("fractions", {
        operation: "equivalent",
        representation: "bar",
        fractions,
      });
      expect(c.params).toBeDefined();
      const svg = (await renderLibraryModel("fractions", c.params as J)).svg;
      expect(cuts(svg), JSON.stringify(fractions)).toBe(3);
      expect(drawingWordsMismatch("fractions", svg, "Two quarters make one half")).toBeUndefined();
    }
  });
});

describe("stated counts: numbers that name things are not counts", () => {
  const vs = (s: string) => statedCounts(s).map((q) => q.v);
  test("labels, ordinals and years are left out", () => {
    expect(vs("Year 3: Step 2 of Part 1")).toEqual([]);
    expect(vs("Question 4 on page 12")).toEqual([]);
    expect(vs("The 2nd and 3rd groups")).toEqual([]);
    expect(vs("The second group has the fourth counter")).toEqual([]);
    expect(vs("Rivers in 1900 and 2024")).toEqual([]);
  });
  test("counts tied to objects and amounts stay", () => {
    expect(vs("Share 12 equally. One half is 6. One quarter is 3.")).toEqual([12, 6, 3]);
    expect(vs("Year 5: share 20 sweets between 4 children")).toEqual([20, 4]);
    expect(vs("Step 1: 1,200 people")).toEqual([1200]);
    expect(vs("Two fifths of 35")).toEqual([35]);
  });
});
