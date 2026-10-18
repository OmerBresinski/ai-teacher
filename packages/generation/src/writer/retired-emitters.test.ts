import { describe, expect, test } from "bun:test";
import { asTableText, splitWordsOnly } from "./fallbacks";
import { SWITCH } from "./fixes";
import { pilotRequest } from "./pilot-pack";

/*
 * Ruling 218's code half (TEACH-110 part t): no writer code path makes a layout production's pack
 * retired. A table that cannot draw becomes a words-only split-compare when production's caps hold
 * it, else explain; a picture sequence's fit repair may switch to split-compare. Saved decks and
 * stored writer JSON with compare still render (materialise's case stays).
 */

type S = Record<string, unknown>;
const RETIRED = ["compare", "cards-grid"];
const slide = (lead?: string): S => ({
  template: "visual-text",
  heading: "Day and night",
  ...(lead ? { lead } : {}),
  points: [],
});
const words = (n: number) => Array.from({ length: n }, (_, k) => `w${k}`).join(" ");
const splitDef = () => {
  const r = pilotRequest("v4.7", "KS2", { properties: {}, $defs: {} }, (x) => x);
  return r.schema.$defs["split-compare"] as { required: string[]; properties: S };
};

describe("asTableText never writes compare", () => {
  test("two short rows become a words-only split-compare, every cell kept", () => {
    const out = asTableText(
      slide(),
      {
        header: ["Side", "Facing the Sun", "Light"],
        rows: [
          ["Day side", "yes", "bright"],
          ["Night side", "no", "dark"],
        ],
      },
      "KS2",
    );
    expect(out.template).toBe("split-compare");
    expect(out.sides).toEqual([
      { title: "Day side", text: "Facing the Sun: yes; Light: bright", quote: null, picture: null },
      { title: "Night side", text: "Facing the Sun: no; Light: dark", quote: null, picture: null },
    ]);
    // It is a slide production's schema accepts: its def's fields, and no others.
    const def = splitDef();
    expect(Object.keys(out).sort()).toEqual([...def.required].sort());
  });

  test("three rows within KS2's 3-side cap are a split; one over it goes to explain", () => {
    const cap = splitWordsOnly("KS2", 3)?.text ?? 0;
    expect(cap).toBeGreaterThan(0);
    const rows = (n: number) => [
      ["A", words(cap)],
      ["B", words(n)],
      ["C", words(2)],
    ];
    expect(asTableText(slide(), { rows: rows(cap) }, "KS2").template).toBe("split-compare");
    const over = asTableText(slide(), { rows: rows(cap + 1) }, "KS2");
    expect(over.template).toBe("explain");
    expect((over.points as S[]).map((p) => p.label)).toEqual(["A", "B", "C"]);
  });

  test("four rows go to explain (split-compare holds 3)", () => {
    const out = asTableText(
      slide(),
      {
        rows: [
          ["A", "one"],
          ["B", "two"],
          ["C", "three"],
          ["D", "four"],
        ],
      },
      "KS3-5",
    );
    expect(out.template).toBe("explain");
    expect((out.points as S[]).length).toBe(4);
  });

  test("a lead (the slide's own, or a column every row shares) has no place on a split: explain", () => {
    const t = {
      rows: [
        ["A", "one", "same"],
        ["B", "two", "same"],
      ],
    };
    expect(asTableText(slide("The Earth spins."), t, "KS2").template).toBe("explain");
    const shared = asTableText(slide(), t, "KS2");
    expect(shared.template).toBe("explain");
    expect(shared.lead).toBe("same.");
  });

  test("no table of 1 to 6 rows, at any stage, comes out as a retired layout", () => {
    for (const stage of ["KS1", "KS2", "KS3-5"] as const)
      for (let n = 1; n <= 6; n += 1) {
        const rows = Array.from({ length: n }, (_, k) => [`R${k}`, "a b"]);
        expect(RETIRED).not.toContain(asTableText(slide(), { rows }, stage).template);
      }
  });

  test("production's menu states a words-only room for 2 and 3 sides at every stage", () => {
    for (const stage of ["KS1", "KS2", "KS3-5"] as const)
      for (const n of [2, 3]) expect(splitWordsOnly(stage, n)?.text).toBeGreaterThan(0);
    expect(splitWordsOnly("KS2", 4)).toBeUndefined();
  });
});

describe("the fit repair's switches never name a retired layout", () => {
  test("a picture sequence may switch to split-compare", () => {
    expect(SWITCH["picture-sequence"]).toEqual(["split-compare"]);
  });
  test("no switch starts from or goes to compare or cards-grid", () => {
    for (const [from, to] of Object.entries(SWITCH)) {
      expect(RETIRED).not.toContain(from);
      for (const t of to) expect(RETIRED).not.toContain(t);
    }
  });
});
