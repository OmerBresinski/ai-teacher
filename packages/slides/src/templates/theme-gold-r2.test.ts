import { describe, expect, test } from "bun:test";
import type { ImageElement, PathElement, ShapeElement, Slide } from "@tj/domain/documents";
import { contrastRatio } from "../colour-contrast";
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

describe("contrast of the verdict glyph and the library icons' outlines (review of #600)", () => {
  const strokesOf = (svg: string) => {
    const n: Record<string, number> = {};
    for (const m of svg.matchAll(/stroke:(#[0-9a-fA-F]{6})/g))
      n[m[1] as string] = (n[m[1] as string] ?? 0) + 1;
    return Object.entries(n).sort((a, b) => b[1] - a[1]);
  };
  const svgOf = (e: { src: string }) => decodeURIComponent(e.src.replace(/^data:[^,]*,/, ""));
  const hexOf = (c: string) => {
    const m = /^rgb\((\d+),\s*(\d+),\s*(\d+)\)$/.exec(c);
    return m
      ? `#${m
          .slice(1, 4)
          .map((v) => Number(v).toString(16).padStart(2, "0"))
          .join("")}`
      : c.slice(0, 7);
  };
  const myth = MYTH_CASES.find((m) => m.name === "y6-falling") as Case;
  let outlineOf: (svg: string) => string | undefined = () => undefined;
  const bread = STAGE_CASES.find((s) => s.name === "05-y5-bread-5-icons") as Case;
  for (const t of THEMES)
    test(`${t.id}: the verdict glyph reads on its disc, and every icon outline on its face, at 3:1`, () => {
      const ink = t.colors.ink.toLowerCase();
      outlineOf = (svg) =>
        strokesOf(svg).some(([c]) => c.toLowerCase() === ink) ? ink : undefined;
      const m = els(myth.input, t.id, myth.stage);
      const disc = m.find((e) => e.name === MYTH_NAMES.stampDisc) as ShapeElement;
      const glyph = m.find((e) => e.name === MYTH_NAMES.stampGlyph) as PathElement;
      expect(
        contrastRatio(hexOf(glyph.stroke as string), hexOf(disc.fill as string)),
      ).toBeGreaterThanOrEqual(3);
      // Proof icons: the outline on the medal face (the drawing's first disc, the darks' deep face).
      for (const e of m.filter(
        (x) => x.type === "image" && x.name === "Proof icon",
      ) as ImageElement[]) {
        const svg = svgOf(e);
        const face = /<circle[^>]*style="fill:(#[0-9a-fA-F]{6})"/.exec(svg)?.[1];
        // The pilot style's outline is the theme's ink (a drawing's own grey detail lines are not
        // its outline); a theme drawing soft icons has none to check.
        const ink = outlineOf(svg);
        if (face && ink) expect([t.id, contrastRatio(ink, face) >= 3]).toEqual([t.id, true]);
      }
      // Stage icons: the outline on the stage frame under it.
      const s = els(bread.input, t.id, bread.stage);
      const frame = s.find((e) => e.name === STAGES_NAMES.frame) as ShapeElement | undefined;
      for (const e of s.filter((x) => x.name === STAGES_NAMES.icon) as ImageElement[]) {
        const ink = outlineOf(svgOf(e));
        if (ink && frame?.fill)
          expect(contrastRatio(ink, hexOf(frame.fill))).toBeGreaterThanOrEqual(3);
      }
    });
  test("the dark themes' glyph is their dark ground on the salmon disc", () => {
    for (const [id, ground] of [
      ["dark-slate", "#1E232B"],
      ["dark-ember", "#1B1B1E"],
    ] as const) {
      const g = els(myth.input, id, myth.stage).find(
        (e) => e.name === MYTH_NAMES.stampGlyph,
      ) as PathElement;
      expect([id, g.stroke?.toUpperCase()]).toEqual([id, ground]);
    }
  });
});

describe("myth verdict row fits the 42px disc (themes4.css .tag: 44px high)", () => {
  const myth = MYTH_CASES.find((m) => m.name === "y6-falling") as Case;
  test("the disc and the MYTH label share one centre, the claim 76px under the row's top", () => {
    for (const t of THEMES) {
      const m = els(myth.input, t.id, myth.stage);
      const disc = m.find((e) => e.name === MYTH_NAMES.stampDisc) as ShapeElement;
      const label = m.find((e) => e.name === MYTH_NAMES.stamp) as El;
      const claim = m.find((e) => e.name === MYTH_NAMES.claim) as El;
      const mid = disc.y + disc.h / 2;
      expect([t.id, Math.abs(mid - (label.y + label.h / 2)) <= 1]).toEqual([t.id, true]);
      // Row top = centre - 22px; the gold's claim box starts 76px below it.
      expect([t.id, Math.round(toPx(claim.y - (mid - 22 / 1.5)))]).toEqual([t.id, 76]);
    }
  });
});

describe("the hinge reveal's stage is square where it bleeds; its cards keep their corners", () => {
  const hinge = {
    template: "hinge",
    heading: "Which of these metals is magnetic?",
    accentWord: "magnetic",
    choices: [
      { text: "Copper", why: "Copper is a metal, and all metals are magnetic." },
      { text: "Iron" },
      { text: "Aluminium", why: "Cans are metal, so a magnet will pick them up." },
      { text: "All of them", why: "All metals are magnetic." },
    ],
    correct: 2,
  } as unknown as TemplateInput;
  for (const [id, card] of [
    ["splash", 39],
    ["treehouse", 15],
    ["dark-slate", 14],
  ] as const)
    test(`${id}: stage radius 0 across the slide, answer cards at the gold's ${card}px`, () => {
      const e = els(hinge, id, "ks2");
      const stage = e.find((x) => x.name === "surface:field-b") as ShapeElement;
      expect(stage.x).toBe(0);
      expect(stage.x + stage.w).toBe(960);
      expect(stage.y + stage.h).toBe(540);
      expect(stage.type === "shape" ? stage.shape : "path").toBe("rect");
      expect(stage.radius ?? 0).toBe(0);
      const cards = e.filter((x) => x.name === "Option" && x.type === "shape") as ShapeElement[];
      expect(cards.length).toBeGreaterThan(0);
      for (const c of cards) if (c.type === "shape") expect(Math.round(toPx(c.radius))).toBe(card);
    });
});
