import { describe, expect, test } from "bun:test";
import type { Slide, TextElement } from "@tj/domain/documents";
import { fitsPlanned, slideFits, stepsTaken } from "./fit-check";
import { materialiseSlide } from "./materialise";
import type { SlideSpec } from "./specs";
import { ladderStops, resolveFontSize } from "./text-style";
import { getTheme, THEMES } from "./themes";

const META = { promptVersion: "test", model: "test", at: "2026-09-30T00:00:00.000Z" };

const short: SlideSpec = {
  kind: "content",
  factRefs: ["k1"],
  heading: "Roots take in water",
  body: "Roots take water and minerals from the soil.",
};

const long: SlideSpec = {
  kind: "content",
  factRefs: ["k1"],
  heading: "Roots, stems and leaves each do a different job for the plant",
  body: Array.from(
    { length: 9 },
    (_, i) =>
      `Point ${i + 1}: the roots hold the plant in the soil and take in water and minerals, which travel up the stem to the leaves.`,
  ).join(" "),
};

const worked: SlideSpec = {
  kind: "worked-example",
  factRefs: ["w1"],
  heading: "Sharing in a ratio",
  question: "Share 35 sweets in the ratio 2 : 5.",
  steps: [
    "Add the parts: 2 + 5 = 7 parts.",
    "Find one part: 35 ÷ 7 = 5 sweets.",
    "Multiply: 2 × 5 = 10 and 5 × 5 = 25.",
    "Check: 10 + 25 = 35.",
  ],
} as SlideSpec;

describe("fitsPlanned", () => {
  test("a short slide fits at body size on every theme", () => {
    const result = fitsPlanned(short, { stepDown: 0 });
    expect(result.failing).toEqual([]);
    expect(result.ok).toBe(true);
  });

  test("a slide whose words run past the safe area fails, at either headroom, naming the themes", () => {
    for (const stepDown of [0, 1] as const) {
      const result = fitsPlanned(long, { stepDown });
      expect(result.ok).toBe(false);
      expect(result.failing.length).toBe(THEMES.length);
      expect(result.failing.every((f) => f.overflow.length > 0 || f.steps > stepDown)).toBe(true);
    }
  });

  test("the save gate allows the one stop down the planning headroom does not", () => {
    // A worked example whose steps only fit a stop down on some themes: planned, it is refused;
    // saved, it passes.
    const plan = fitsPlanned(worked, { stepDown: 0 });
    const save = fitsPlanned(worked, { stepDown: 1 });
    expect(save.ok).toBe(true);
    if (!plan.ok)
      expect(plan.failing.every((f) => f.steps === 1 && f.overflow.length === 0)).toBe(true);
  });

  test("themes can be narrowed", () => {
    const one = fitsPlanned(long, { stepDown: 1, themes: [getTheme("chalk")] });
    expect(one.failing.map((f) => f.theme)).toEqual(["chalk"]);
  });
});

describe("stepsTaken", () => {
  const theme = getTheme("chalk");
  let n = 0;
  const slide = (): Slide => materialiseSlide(short, "chalk", META, () => `e${++n}`);

  test("0 when every text is at its own size", () => {
    expect(stepsTaken(slide(), theme)).toBe(0);
  });

  test("counts ladder stops under the text's own size", () => {
    const s = slide();
    // The key idea under the heading: the last text the recipe lays.
    const body = s.elements.findLast((e): e is TextElement => e.type === "text");
    if (!body) throw new Error("no body");
    const own = resolveFontSize(theme, body.style.preset);
    const next = ladderStops(theme).find((stop) => stop < own - 0.5) as number;
    body.style = { ...body.style, fontSize: next };
    expect(stepsTaken(s, theme)).toBe(1);
    expect(slideFits(s, theme, 0).ok).toBe(false);
    expect(slideFits(s, theme, 1)).toMatchObject({ ok: true, steps: 1 });
  });
});
