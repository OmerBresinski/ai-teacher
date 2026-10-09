import { afterAll, describe, expect, test } from "bun:test";
import { buildCount, svgOfDataUrl } from "@tj/slides/diagram-builds";
import { drawingWordsMismatch, drawnTexts, wordNumbers } from "./consistency";
import { capabilityRefusals, checkParams, libraryDiagram } from "./fill";
import { endDrawThread } from "./guard";
import { boundsRefusals, kit, loadModel, renderLibraryModel } from "./render";
import type { J } from "./types";

/*
 * TEACH-247 part i: a library drawing never contradicts its slide. The cases are prod-lib-1's
 * (scratchpad/ab-prodlib/NOTES.md): the fills are the saved Luna outputs, the words the slides'.
 */
const draw = async (id: string, sent: J) => {
  const m = await loadModel(id);
  const P = (await kit()).withDefaults(m?.params ?? { properties: {} }, sent);
  return (await renderLibraryModel(id, P)).svg;
};

const HALF_OF_16 = "Find one half of 16\nDraw two equal groups. Find how many are in one group.";
const QUARTER_OF_16 =
  "Find one quarter of 16\nDraw four equal groups. Find how many are in one group.";
const THREE_FIFTHS = "Three fifths of 20\nEach fifth is 4. Three fifths is three groups of 4.";
const HALF_OF_12 =
  "Find one half of 12\nShare into two equal groups. One group has 6: one half of 12 is 6.";

describe("the words' numbers", () => {
  test("digits, fractions and number words; 'one' is not a number pupils must see", () => {
    expect(wordNumbers("Three fifths of 20")).toEqual(expect.arrayContaining([20, 3, 5]));
    expect(wordNumbers("one half of 16")).toEqual([16, 2]);
    expect(wordNumbers("¾ and 2/5")).toEqual([3, 4, 2, 5]);
  });

  test("a drawing's text is read with tspans joined and entities decoded", () => {
    expect(drawnTexts('<svg><text x="1"><tspan>16</tspan>&#160;÷ 2 = 8</text></svg>')).toEqual([
      "16 ÷ 2 = 8",
    ]);
  });
});

describe("a drawing that disagrees with its slide is refused (prod-lib-1)", () => {
  test("y2 s7: the fill left out the group size, so the default 2 drew 4 ÷ 2 = 2 for 16", async () => {
    const svg = await draw("equal_groups", {
      layout: "groups",
      groups: 2,
      object: "counter",
      division: "sharing",
    });
    expect(drawingWordsMismatch(svg, HALF_OF_16)).toContain("16");
    const right = await draw("equal_groups", { groups: 2, size: 8, division: "sharing" });
    expect(drawingWordsMismatch(right, HALF_OF_16)).toBeUndefined();
  });

  test("y2 s9: 8 ÷ 4 = 2 for one quarter of 16", async () => {
    const svg = await draw("equal_groups", { groups: 4, division: "sharing", countSteps: false });
    expect(drawingWordsMismatch(svg, QUARTER_OF_16)).toBeDefined();
  });

  test("y5 s6: all five groups and 5 × 4 = 20 never show three fifths", async () => {
    const svg = await draw("equal_groups", { groups: 5, size: 4, division: "none" });
    expect(drawingWordsMismatch(svg, THREE_FIFTHS)).toContain("3");
  });

  test("y5 s6: a fraction of an amount drawn by fractions (of, set) shows the three fifths", async () => {
    const svg = await draw("fractions", {
      operation: "of",
      representation: "set",
      fractions: [{ value: "3/5" }],
      amount: 20,
    });
    expect(drawingWordsMismatch(svg, THREE_FIFTHS)).toBeUndefined();
  });

  test("y2 s3: a 'show' of 1/2 and 1/4 draws one half only, so a quarter is missing", async () => {
    const svg = await draw("fractions", {
      operation: "show",
      representation: "rectangle",
      fractions: [{ value: "1/2" }, { value: "1/4" }],
      words: true,
    });
    expect(
      drawingWordsMismatch(
        svg,
        "Equal parts\nOne half: one of two equal parts. One quarter: one of four equal parts.",
      ),
    ).toContain("4");
  });

  test("y2 s10: a slide that names A, B and C needs them drawn", async () => {
    const svg = await draw("fractions", { operation: "show", words: false });
    expect(
      drawingWordsMismatch(svg, "Name the shaded fraction\nWrite half for A, B and C."),
    ).toContain("A, B, C");
  });

  test("y2 s6: the right drawing passes", async () => {
    const svg = await draw("equal_groups", { groups: 2, size: 6, division: "sharing" });
    expect(drawingWordsMismatch(svg, HALF_OF_12)).toBeUndefined();
  });

  test("libraryDiagram sends a disagreeing drawing to the drawer", async () => {
    const r = await libraryDiagram(
      {
        key: "diagram",
        model: "equal_groups",
        intent: "Question: show sixteen counters and two empty rings.",
        words: HALF_OF_16,
        yearGroup: "Year 2",
        lesson: "Maths: halves",
      },
      async () => ({ layout: "groups", groups: 2, object: "counter", division: "sharing" }),
    );
    expect(r).toMatchObject({ ok: false, fallbackKind: "equal-groups" });
    if (!r.ok) expect(r.reason).toContain("disagrees with the slide");
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
    const r = await checkParams("fractions", { whole: "x".repeat(61) });
    expect(r.params).toBeUndefined();
    const long = await checkParams("equal_groups", { groups: 16 });
    expect(long.params).toBeUndefined();
  });

  test("the draw itself refuses out-of-bounds params", async () => {
    await expect(renderLibraryModel("equal_groups", { groups: 1e9 })).rejects.toThrow(
      /out of range/,
    );
  });
});

describe("Present never opens a library model on an empty box", () => {
  test("every drawing is a still: no builds", async () => {
    const svg = await draw("equal_groups", { groups: 2, size: 6, division: "sharing" });
    expect(buildCount(svg)).toBe(0);
    const r = await renderLibraryModel(
      "fractions",
      (await kit()).withDefaults((await loadModel("fractions"))?.params ?? { properties: {} }, {}),
    );
    expect(r.builds).toBe(0);
    expect(buildCount(svgOfDataUrl(r.src) ?? "")).toBe(0);
  });
});

afterAll(() => endDrawThread());
