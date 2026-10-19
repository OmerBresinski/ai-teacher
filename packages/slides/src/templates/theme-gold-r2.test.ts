import { describe, expect, test } from "bun:test";
import type { ImageElement, PathElement, ShapeElement, Slide } from "@tj/domain/documents";
import { loadIcons } from "../icons/loader";
import { atKeyStage, getTheme, THEMES } from "../themes";
import { paintSurface } from "../themes/surfaces";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { MYTH_NAMES } from "./myth";
import { MYTH_CASES } from "./myth-fixtures";
import { STAGES_NAMES } from "./stages";
import { STAGE_CASES } from "./stages-fixtures";
import { WORKED_NAMES } from "./worked";
import { WORKED_CASES } from "./worked-fixtures";

/*
 * TEACH-215 part r2 (THEME-AUDIT-r2 ranked gaps 1, 2, 3 and 9): fixed values read from the round 5
 * golds' own CSS (theme-v2.css, roles.css, round 2-5 themes CSS, computed per theme). Slides are
 * 960pt for the golds' 1440px, so a gold px is pt x 1.5.
 */
await loadIcons();
type El = Slide["elements"][number];
type Case = { input: TemplateInput; stage: Stage };
const els = (input: TemplateInput, id: string, stage: Stage) =>
  layoutTemplate(input, atKeyStage(getTheme(id), stage), stage).slide.elements as El[];
const toPx = (pt: number | undefined) => Math.round((pt ?? 0) * 1.5 * 100) / 100;

describe("worked answer plate: the gold's --plate-fill, --plate-line, --plate-lw, --plate-radius", () => {
  // [fill, line, lw px, radius px] (roles.css plate role; themes3/4/5 product and dark blocks).
  const GOLD: Record<string, [string, string, number, number]> = {
    treehouse: ["#FFFFFF", "#245F28", 3, 15],
    "reading-room": ["#FFFFFF", "#1F5A45", 3, 9],
    storytime: ["#FFFFFF", "#1F5FBF", 4, 22],
    scrapbook: ["#FFFFFF", "#1F57B8", 3, 3],
    calm: ["#FFFFFF", "#245150", 3, 10],
    beacon: ["#FFFFFF", "#0A46C8", 3, 9],
    crayon: ["#FFFFFF", "#A31F2E", 3, 9],
    "exam-hall": ["#F3F5F8", "#1B3A8C", 3, 6],
    playground: ["#FFFFFF", "#6532BE", 3, 33],
    splash: ["#FFFFFF", "#0A5CA2", 3, 39],
    studio: ["#FFFFFF", "#0B6E86", 3, 21],
    "dark-slate": ["#262C35", "#9DBBD0", 3, 14],
    "dark-ember": ["#252528", "#F2A08C", 3, 12],
  };
  for (const [id, [fill, line, lw, radius]] of Object.entries(GOLD))
    test(`${id}: ${fill} plate, ${line} ${lw}px line, ${radius}px corners`, () => {
      const k = WORKED_CASES[id === "storytime" ? "y6-panel" : "y8-panel"] as Case;
      const plate = els(k.input, id, k.stage).find(
        (e) => e.name === WORKED_NAMES.plate,
      ) as ShapeElement;
      expect(plate).toBeDefined();
      expect(plate.fill?.toUpperCase()).toBe(fill);
      expect(plate.stroke?.toUpperCase()).toBe(line);
      expect(Math.round(toPx(plate.strokeWidth))).toBe(lw);
      expect(Math.round(toPx(plate.radius))).toBe(radius);
    });
  test("Paper keeps its accent-wash plate (roles.css default, already the gold)", () => {
    const k = WORKED_CASES["y8-panel"] as Case;
    const plate = els(k.input, "paper", k.stage).find(
      (e) => e.name === WORKED_NAMES.plate,
    ) as ShapeElement;
    expect(plate.fill?.toUpperCase()).toBe("#FCE3E0");
    expect(plate.stroke?.toUpperCase()).toBe("#D7263D");
  });
});

describe("a field that bleeds off the slide is square (gold --fa-radius / --fb-radius: 0px)", () => {
  const ROUND = ["storytime", "scrapbook", "playground", "splash", "dark-slate", "dark-ember"];
  test("the worked panel, flush to the right edge, has no rounded corner", () => {
    for (const id of ROUND) {
      const k = WORKED_CASES["y8-panel"] as Case;
      const field = els(k.input, id, k.stage).find((e) => e.name === WORKED_NAMES.field) as
        | ShapeElement
        | PathElement;
      expect(field).toBeDefined();
      if (field.type === "shape") expect([id, field.shape]).toEqual([id, "rect"]);
    }
  });
  test("the myth panels (claim and fact) are square in Treehouse and Calm too", () => {
    const k = MYTH_CASES.find((m) => m.name === "y6-falling") as Case;
    for (const id of [...ROUND, "treehouse", "calm"]) {
      const panels = els(k.input, id, k.stage).filter(
        (e) => e.name === MYTH_NAMES.panel || e.name === MYTH_NAMES.factPanel,
      ) as ShapeElement[];
      expect(panels.length).toBe(2);
      for (const p of panels)
        if (p.type === "shape") expect([id, p.name, p.shape]).toEqual([id, p.name, "rect"]);
    }
  });
  test("a field inside the slide keeps the theme's corner", () => {
    const inside = paintSurface(
      { id: "f", role: "field-b", box: { x: 40, y: 40, w: 300, h: 200 } },
      getTheme("storytime"),
    ) as ShapeElement;
    expect(inside.shape).toBe("rounded");
    expect(Math.round(toPx(inside.radius))).toBe(32);
    const bleeding = paintSurface(
      { id: "f", role: "field-b", box: { x: 600, y: 0, w: 360, h: 540 } },
      getTheme("storytime"),
    ) as ShapeElement;
    expect(bleeding.shape).toBe("rect");
  });
});

describe("myth verdict disc: themes4.css all themes, .stamp i 42px in the verdict-wrong red", () => {
  const k = MYTH_CASES.find((m) => m.name === "y6-falling") as Case;
  for (const t of THEMES)
    test(`${t.id}: a 42px disc in the theme's sem-incorrect`, () => {
      const disc = els(k.input, t.id, k.stage).find(
        (e) => e.name === MYTH_NAMES.stampDisc,
      ) as ShapeElement;
      expect(Math.round(toPx(disc.w))).toBe(42);
      expect(Math.round(toPx(disc.h))).toBe(42);
      // Written as rgb(): render-time re-theming would read #D7263D as Paper's accent token and
      // paint Scrapbook's disc blue, Calm's teal (THEME-AUDIT-r2 #9).
      expect(disc.fill).toMatch(/^rgb\(/);
    });
  test("Scrapbook's and Calm's discs are the red #D7263D, not their accent", () => {
    for (const id of ["scrapbook", "calm"]) {
      const disc = els(k.input, id, k.stage).find(
        (e) => e.name === MYTH_NAMES.stampDisc,
      ) as ShapeElement;
      expect(disc.fill).toBe("rgb(215, 38, 61)");
    }
  });
});

describe("library icons outlined in ink (the golds draw the pilot library in every theme)", () => {
  const svgOf = (e: ImageElement) => decodeURIComponent(e.src.replace(/^data:[^,]*,/, ""));
  const stage = STAGE_CASES.find((s) => s.name === "05-y5-bread-5-icons") as Case;
  test("every theme's stages icons are the outlined (pilot) drawing, not the soft one", () => {
    for (const t of THEMES) {
      const icons = els(stage.input, t.id, stage.stage).filter(
        (e) => e.name === STAGES_NAMES.icon,
      ) as ImageElement[];
      expect(icons.length).toBeGreaterThan(0);
      // The pilot style draws flat fills under a dark outline; the soft style's radial gradients
      // are what the audit saw as washed out.
      for (const i of icons)
        expect([t.id, svgOf(i).includes("radialGradient")]).toEqual([t.id, false]);
    }
  });
});
