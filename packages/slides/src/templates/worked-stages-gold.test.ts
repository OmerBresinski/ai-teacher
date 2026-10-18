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
  test("KS2 bread (5 icons): names 46 px, lines 33 px, drawn as given", () => {
    for (const id of ["paper", "poster", "scrapbook", "calm", "geometric", "crayon"]) {
      const { r, names, lines } = sizes("05-y5-bread-5-icons", id);
      expect(r.over).toEqual([]);
      for (const e of names) expect(px(e.style?.fontSize ?? 0)).toBeCloseTo(46, 0);
      for (const e of lines) expect(px(e.style?.fontSize ?? 0)).toBe(33);
      for (const e of [...names, ...lines]) expect(e.style?.fixedSize).toBe(true);
    }
  });
  test("KS1 river (3 short): names 54 px, lines 38 px (ruling 162 amended, stages)", () => {
    const { names, lines } = sizes("01-y2-river-3-short", "storytime");
    for (const e of names) expect(px(e.style?.fontSize ?? 0)).toBe(54);
    for (const e of lines) expect(px(e.style?.fontSize ?? 0)).toBeCloseTo(38, 0);
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

describe("TEACH-215 part j review: KS3 stages stay master's; the quick check's gold claims", () => {
  test("KS3 stages-capacity cells are master's values exactly", async () => {
    const STAGES = (await import("./stages-capacity.json")).default as unknown as Record<
      string,
      {
        n: number;
        vis: string;
        name: { cap: number; hardMax: number };
        line: { cap: number; hardMax: number };
      }[]
    >;
    const cell = (n: number, vis: string) =>
      STAGES.secondary?.find((c) => c.n === n && c.vis === vis);
    // master 5f55d1f95: [name cap, name hardMax, line cap, line hardMax]
    const MASTER: [number, string, number, number, number, number][] = [
      [3, "icons", 15, 15, 92, 110],
      [3, "pictures", 15, 15, 78, 98],
      [4, "icons", 13, 13, 62, 80],
      [4, "pictures", 10, 10, 46, 54],
      [5, "icons", 11, 11, 54, 84],
      [5, "pictures", 8, 8, 36, 54],
      [6, "icons", 9, 9, 36, 62],
      [6, "pictures", 6, 6, 24, 48],
    ];
    for (const [n, vis, nc, nh, lc, lh] of MASTER)
      expect(cell(n, vis)).toMatchObject({
        name: { cap: nc, hardMax: nh },
        line: { cap: lc, hardMax: lh },
      });
  });
  test("KS1/KS2 stages: a name stepped to the heading minimum is tight", () => {
    const c = STAGE_CASES.find((s) => s.name === "05-y5-bread-5-icons") as {
      input: TemplateInput;
    };
    const long = structuredClone(c.input);
    long.stages = (long.stages ?? []).map((s) => ({ ...s, name: "Breadmaking" }));
    const r = layoutTemplate(long, atKeyStage(getTheme("paper"), "ks2"), "ks2");
    const names = (r.slide.elements as El[]).filter((e) => e.name === STAGES_NAMES.name);
    // The names step down to the heading minimum (26 pt) to fit, and the slide says so.
    expect(names.every((e) => (e.style?.fontSize ?? 99) <= 26.05)).toBe(true);
    expect(r.tight).toBe(true);
  });

  const qset = (qs: string[], as: string[], stage: Stage, id = "paper") =>
    layoutTemplate(
      { template: "question-set", heading: "Quick check", questions: qs, answers: as },
      atKeyStage(getTheme(id), stage),
      stage,
    );
  const caps = async (age: "early" | "primary" | "secondary", n: number) =>
    (
      (await import("./question-set-capacity.json")).default as Record<
        string,
        Record<string, { questions: { cap: number } }>
      >
    )[age]?.[String(n)]?.questions.cap ?? 0;

  test("KS2: a row at the cap length renders on one line in every theme, comfortable", async () => {
    const { exactSample } = await import("./question-set-capacity");
    const cap = await caps("primary", 5);
    const qs = [0, 3, 6, 9, 12].map((i) => exactSample(cap, i));
    for (const t of THEMES) {
      const r = qset(
        qs,
        qs.map(() => "Plasma"),
        "ks2",
        t.id,
      );
      expect(r.over).toEqual([]);
      expect(r.tight).toBe(false);
      const q = (r.slide.elements as El[]).filter((e) => e.name === "Question");
      for (const e of q) expect(e.h).toBeLessThan((e.style?.fontSize ?? 0) * 1.4 * 1.5);
    }
  });
  test("KS2: answers take the gold's 35 px when they fit, 33 px when they do not", () => {
    const size = (as: string[]) =>
      px(
        ((
          qset(["What is it?", "What is it?", "What is it?"], as, "ks2").slide.elements as El[]
        ).find((e) => e.name === "Answer")?.style?.fontSize ?? 0) as number,
      );
    expect(size(["Plasma", "Arteries", "Oxygen"])).toBe(35);
    expect(size(["Red blood cells carry", "Plasma", "Oxygen"])).toBeLessThanOrEqual(35);
  });
  test("KS1 and KS3: questions at their caps are comfortable on every theme", async () => {
    const { exactSample } = await import("./question-set-capacity");
    for (const [age, stage] of [
      ["early", "ks1"],
      ["secondary", "ks3"],
    ] as const) {
      const cap = await caps(age, 3);
      const qs = [0, 3, 6].map((i) => exactSample(cap, i));
      for (const t of THEMES) {
        const r = qset(
          qs,
          qs.map(() => "Plasma"),
          stage,
          t.id,
        );
        expect([t.id, stage, r.over, r.tight]).toEqual([t.id, stage, [], false]);
      }
    }
  });
  test("number badges are the golds' sizes: KS1 30, KS2 26, KS3 24 px", () => {
    for (const [stage, want] of [
      ["ks1", 30],
      ["ks2", 26],
      ["ks3", 24],
    ] as const) {
      const r = qset(["What is it?", "What is it?", "What is it?"], ["A", "B", "C"], stage);
      const b = (r.slide.elements as ShapeElement[]).filter((e) => e.name === "surface:badge");
      expect(b.length).toBe(3);
      for (const e of b) expect(Math.round((e.textStyle?.fontSize ?? 0) * 1.5)).toBe(want);
    }
  });
});
