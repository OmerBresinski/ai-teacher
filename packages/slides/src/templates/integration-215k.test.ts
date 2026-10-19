import { describe, expect, test } from "bun:test";
import type { PathElement, ShapeElement, Slide, TextElement } from "@tj/domain/documents";
import { withThemeColours } from "../theme-colours";
import { getTheme } from "../themes";
import { surfaceName } from "../themes/surfaces";
import { layoutTemplate } from "./index";
import { MYTH_NAMES } from "./myth";
import { MYTH_CASES } from "./myth-fixtures";
import { QUICK_NAMES } from "./question-set";
import { STAGES_NAMES } from "./stages";
import { STAGE_CASES } from "./stages-fixtures";

/*
 * TEACH-215 part k, integration: what the shape lane handed across to the templates. The quick
 * check's badges and answer column, the stages connector family, the myth's torn claim and the
 * Poster title band drawn in another theme.
 */

const quick = {
  template: "question-set",
  heading: "Quick check: the heart",
  questions: ["Which organ pumps blood?", "Which vessels carry blood away?"],
  answers: ["The heart", "Arteries"],
} as const;
const lay = (input: object, id: string, stage: "ks1" | "ks2" | "ks3" = "ks2") =>
  layoutTemplate(input as never, getTheme(id), stage).slide;
const named = (s: Pick<Slide, "elements">, n: string) => s.elements.filter((e) => e.name === n);

describe("quick check", () => {
  test("scrapbook's number badges are the gold's outline ring, calm's rounded squares", () => {
    const [b] = named(lay(quick, "scrapbook"), surfaceName("badge")) as ShapeElement[];
    expect(b).toMatchObject({ fill: "transparent", stroke: "#1F57B8" });
    expect(b?.textStyle?.color).toBe("#1F57B8");
    const [c] = named(lay(quick, "calm"), surfaceName("badge")) as ShapeElement[];
    expect(c?.shape).toBe("rounded");
    const [g] = named(lay(quick, "geometric"), surfaceName("badge")) as ShapeElement[];
    expect(g?.shape).toBe("hexagon");
  });
  test("beacon and poster set the answers on a solid column in its ink", () => {
    for (const [id, fill, ink] of [
      ["beacon", "#0A46C8", "#FFFFFF"],
      ["poster", "#123C4A", "#FFF4E2"],
    ] as const) {
      const s = lay(quick, id);
      expect(s.elements.some((e) => e.type === "shape" && e.fill === fill)).toBe(true);
      for (const a of named(s, QUICK_NAMES.answer) as TextElement[])
        expect(a.style.color).toBe(ink);
    }
  });
});

describe("stages connectors in each theme's family", () => {
  const c = STAGE_CASES.find((x) => x.name === "05-y5-bread-5-icons");
  const arrows = (id: string) =>
    named(
      layoutTemplate(c?.input as never, getTheme(id), c?.stage ?? "ks2").slide,
      STAGES_NAMES.arrow,
    ) as PathElement[];
  test("scrapbook's sketch is open strokes, poster's block sits on an ink offset, storytime's is rounded", () => {
    expect(arrows("scrapbook").every((a) => a.closed === false && !a.fill)).toBe(true);
    const poster = arrows("poster");
    expect(poster.some((a) => a.fill === "#1B1B2F")).toBe(true);
    expect(arrows("storytime").every((a) => a.closed && (a.strokeWidth ?? 0) > 0)).toBe(true);
    // the block family keeps its own drawing (one closed arrow per seam)
    expect(arrows("paper").length).toBe(4);
  });
});

describe("myth: a torn claim panel", () => {
  test("the verdict ground runs under it, so the claim card never shows through the tear", () => {
    const m = MYTH_CASES.find((x) => x.name === "y6-falling");
    const s = layoutTemplate(m?.input as never, getTheme("scrapbook"), m?.stage ?? "ks2").slide;
    const [ground] = named(s, MYTH_NAMES.cover) as ShapeElement[];
    expect(ground?.x).toBe(0);
    const g = layoutTemplate(m?.input as never, getTheme("geometric"), m?.stage ?? "ks2").slide;
    expect((named(g, MYTH_NAMES.cover)[0] as ShapeElement).x).toBeGreaterThan(0);
  });
});

describe("the poster band in another theme", () => {
  test("drawn in paper: no band, the heading in paper's own ink and accent", () => {
    const s = lay(
      {
        template: "hinge",
        heading: "Which of these is magnetic?",
        accentWord: "magnetic",
        options: ["Iron", "Copper"],
        correct: 1,
      },
      "poster",
    );
    const band = named(s, surfaceName("title"))[0] as ShapeElement;
    expect(band.fill).toBe("#123C4A");
    const paper = getTheme("paper");
    const drawn = withThemeColours({ id: "s", ...s }, paper);
    // The band paper does not draw is left out, no invisible rect kept (review N1).
    expect(named(drawn, surfaceName("title"))).toEqual([]);
    const h = named(drawn, "Heading")[0] as TextElement;
    expect(h.style.color).toBe(paper.colors.heading ?? paper.colors.ink);
    expect(JSON.stringify(h.doc)).toContain(paper.colors.accent);
    const back = withThemeColours({ id: "s", ...s }, getTheme("poster"));
    expect((named(back, "Heading")[0] as TextElement).style.color).toBe("#FFF4E2");
    expect((named(back, surfaceName("title"))[0] as ShapeElement).fill).toBe("#123C4A");
  });
});
