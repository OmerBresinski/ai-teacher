import { describe, expect, test } from "bun:test";
import type { ShapeElement, Slide } from "@tj/domain/documents";
import { loadIcons } from "../icons/loader";
import { mathFaceOf } from "../text-measure";
import { atKeyStage, getTheme, THEMES } from "../themes";
import { surfacesOf } from "../themes/surfaces";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { STAGES_NAMES } from "./stages";
import { STAGE_CASES } from "./stages-fixtures";
import { WORKED_NAMES } from "./worked";
import { WORKED_CASES } from "./worked-fixtures";

/*
 * TEACH-215 part j (THEME-AUDIT 18 Oct, causes C10, C11, C12): the worked example's variables in
 * the gold's italic maths face, its moves at the gold's 36 px where the measured fit allows, its
 * rail badges in the theme's `badge-fill` / `badge-now`; stages at the gold's name and line sizes,
 * the line held at the stage's reading floor (ruling 162).
 */
await loadIcons();
type El = Slide["elements"][number] & { style?: { fontSize?: number; fixedSize?: boolean } };
const px = (pt: number) => Math.round(pt * 1.5 * 10) / 10;
const worked = (k: string, id: string) => {
  const c = WORKED_CASES[k] as { input: TemplateInput; stage: Stage };
  return layoutTemplate(c.input, atKeyStage(getTheme(id), c.stage), c.stage);
};

describe("worked example: rail badges take the theme's badge tokens (C12)", () => {
  for (const t of THEMES)
    test(`${t.id}: the now badge is badge-now, the done badge badge-fill`, () => {
      const els = worked("y8-panel", t.id).slide.elements as ShapeElement[];
      const s = surfacesOf(t);
      const nowFill = s.states["badge:now"]?.fill ?? s.badgeNow;
      const solid = (e: ShapeElement) => e.fill !== "transparent";
      const now = els.filter((e) => e.name === WORKED_NAMES.badge);
      const done = els.filter((e) => e.name === WORKED_NAMES.done);
      expect(now.length).toBeGreaterThan(0);
      expect(done.length).toBe(now.length - 1);
      for (const e of now.filter(solid)) expect(e.fill).toBe(nowFill);
      if (s.marks.badge !== "outline")
        for (const e of done) expect(e.fill).toBe(s.roles.badge.fill);
    });
  test("Treehouse's done badge is its green and its now badge its brown, not ink and accent", () => {
    const els = worked("y8-panel", "treehouse").slide.elements as ShapeElement[];
    expect(els.find((e) => e.name === WORKED_NAMES.done)?.fill).toBe("#245F28");
    expect(els.find((e) => e.name === WORKED_NAMES.badge)?.fill).toBe("#8A4B12");
  });
});

describe("worked example: maths and moves (C11)", () => {
  test("every theme sets its variables in Source Serif italic", () => {
    for (const t of THEMES) expect(mathFaceOf(t)).toMatchObject({ italic: true });
  });
  test("the y8 base moves are the gold's 36 px in every theme", () => {
    for (const t of THEMES) {
      const r = worked("y8", t.id);
      expect(r.over).toEqual([]);
      const moves = (r.slide.elements as El[]).filter((e) => e.name === WORKED_NAMES.move);
      for (const m of moves) expect(px(m.style?.fontSize ?? 0)).toBe(36);
    }
  });
  test("beside the panel, Paper's moves are 35 px (34 on master) and Treehouse's 36 px", () => {
    const size = (id: string) =>
      px(
        ((worked("y8-panel", id).slide.elements as El[]).find((e) => e.name === WORKED_NAMES.move)
          ?.style?.fontSize ?? 0) as number,
      );
    expect(size("paper")).toBe(35);
    expect(size("treehouse")).toBe(36);
  });
});

describe("stages: the gold's sizes, the line held at the reading floor (C10)", () => {
  const sizes = (name: string, id: string) => {
    const c = STAGE_CASES.find((s) => s.name === name) as { input: TemplateInput; stage: Stage };
    const r = layoutTemplate(c.input, atKeyStage(getTheme(id), c.stage), c.stage);
    const els = r.slide.elements as El[];
    const of = (n: string) => els.filter((e) => e.name === n);
    return { r, names: of(STAGES_NAMES.name), lines: of(STAGES_NAMES.line) };
  };
  test("KS2 bread (5 icons): names 46 px, lines 37.5 px, drawn as given", () => {
    for (const id of ["paper", "poster", "scrapbook", "calm", "geometric", "crayon"]) {
      const { r, names, lines } = sizes("05-y5-bread-5-icons", id);
      expect(r.over).toEqual([]);
      for (const e of names) expect(px(e.style?.fontSize ?? 0)).toBeCloseTo(46, 0);
      for (const e of lines) expect(px(e.style?.fontSize ?? 0)).toBe(37.5);
      for (const e of [...names, ...lines]) expect(e.style?.fixedSize).toBe(true);
    }
  });
  test("KS1 river (3 short): names 54 px, lines 42 px (gold 38, held at KS1's 28 pt)", () => {
    const { names, lines } = sizes("01-y2-river-3-short", "storytime");
    for (const e of names) expect(px(e.style?.fontSize ?? 0)).toBe(54);
    for (const e of lines) expect(px(e.style?.fontSize ?? 0)).toBe(42);
  });
});

describe("quick check: comfort per stage's gold, caps to the character (C8 follow-up)", () => {
  const quick = (qs: string[], stage: Stage, id = "paper") =>
    layoutTemplate(
      {
        template: "question-set",
        heading: "Quick check",
        questions: qs,
        answers: qs.map(() => "Plasma"),
      },
      atKeyStage(getTheme(id), stage),
      stage,
    );
  const KS3 = "Which process releases energy from glucose inside the mitochondria of a cell?";
  test("KS3: a 16-word question on two lines is comfortable, as the gold sets it", () => {
    const r = quick([KS3, "What is it?", "What is it?"], "ks3");
    expect(r.over).toEqual([]);
    expect(r.tight).toBe(false);
  });
  test("KS1: the gold's 51-character question is comfortable", () => {
    const r = quick(
      [
        "Sam has 23 stickers. He gets 20 more. How many now?",
        "What is 46 + 30?",
        "What is 85 − 40?",
      ],
      "ks1",
      "storytime",
    );
    expect(r.over).toEqual([]);
    expect(r.tight).toBe(false);
  });
  test("KS2: two lines stay tight (the gold's one-line pass)", () => {
    const r = quick([KS3, "What is it?", "What is it?"], "ks2");
    expect(r.tight).toBe(true);
  });
  test("KS2 caps are the real room, cut to the character: 47 at 3, 46 at 4-6", async () => {
    const { measureQuickCaps, exactSample } = await import("./question-set-capacity");
    expect(exactSample(46, 3)).toHaveLength(46);
    expect(measureQuickCaps("primary", 3).questions.cap).toBe(47);
    for (const n of [4, 5, 6]) expect(measureQuickCaps("primary", n).questions.cap).toBe(46);
  });
});
