import { describe, expect, test } from "bun:test";
import { type Slide, slideStepCount } from "@tj/domain/documents";
import { atKeyStage, getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import {
  mathText,
  moveHot,
  panelDraws,
  snap,
  splitWorked,
  WORKED_NAMES,
  workedMax,
} from "./worked";
import { measureWorkedCapacity } from "./worked-capacity";
import CAPACITY from "./worked-capacity.json" with { type: "json" };
import { WORKED_CASES } from "./worked-fixtures";

/*
 * TEACH-17 part b (C1, NOTES worked v12): the worked example lines up its "=" column on the widest
 * left side, reveals one row per click (badge, rail, move, equation, answer plate), and shows a
 * bar-model panel whose build i rides row i only when its guard holds; otherwise the text-only base.
 */
const NEG = "−";
type El = Slide["elements"][number] & { style?: { fontSize?: number }; doc?: unknown };
const lay = (k: string, theme = getTheme("paper")) => {
  const c = WORKED_CASES[k] as { input: TemplateInput; stage: Stage };
  return layoutTemplate(c.input, theme, c.stage);
};
const named = (els: readonly El[], n: string) => els.filter((e) => e.name === n);
const words = (e: El) =>
  JSON.stringify(e.doc ?? "")
    .match(/"text":"([^"]*)"/g)
    ?.join("") ?? "";

describe("worked example: the = column and one row per click", () => {
  for (const k of Object.keys(WORKED_CASES))
    test(`${k}: every "=" sits on one column, every row is its own step, nothing over`, () => {
      const r = lay(k);
      const els = r.slide.elements as El[];
      expect(r.over).toEqual([]);
      const signs = named(els, WORKED_NAMES.sign);
      const c = WORKED_CASES[k] as { input: TemplateInput };
      const lines = c.input.lines?.length ?? 0;
      expect(signs).toHaveLength(lines);
      const mids = new Set(signs.map((s) => Math.round(s.x + s.w / 2)));
      expect(mids.size).toBe(1);
      // A left side ends at the column; the widest one sets it.
      const lefts = named(els, WORKED_NAMES.left);
      for (const l of lefts) expect(Math.abs(l.x + l.w - (signs[0]?.x ?? 0))).toBeLessThan(12);
      // Row i is step i; the check is the last step.
      const rows = lines + (c.input.check ? 1 : 0);
      for (const [i, s] of signs.entries()) expect(s.revealStep).toBe(i + 1);
      const badges = named(els, WORKED_NAMES.badge);
      expect(badges.map((b) => b.revealStep)).toEqual(
        Array.from({ length: rows }, (_, i) => i + 1),
      );
      expect(slideStepCount(r.slide as Slide)).toBe(rows);
      // The newest row's badge is the accent; the next click covers it with ink (the last stays red).
      const accent = getTheme("paper").colors.accent;
      expect(badges.every((b) => (b as { fill?: string }).fill === accent)).toBe(true);
      expect(named(els, WORKED_NAMES.done).map((b) => b.revealStep)).toEqual(
        Array.from({ length: rows - 1 }, (_, i) => i + 2),
      );
      // Ghost badges show from the start: the class sees how many steps are coming.
      expect(named(els, WORKED_NAMES.ghost).every((g) => !g.revealStep)).toBe(true);
      // Each move rides its own row with its arrow.
      for (const m of named(els, WORKED_NAMES.move))
        expect(named(els, WORKED_NAMES.arrow).some((a) => a.revealStep === m.revealStep)).toBe(
          true,
        );
    });

  test("the check reads at the steps' size, as in the gold (not a size under them)", () => {
    for (const k of ["y8", "stress", "moles"]) {
      const els = lay(k).slide.elements as El[];
      const eq = named(els, WORKED_NAMES.left)[0]?.style?.fontSize ?? 0;
      const check = named(els, WORKED_NAMES.check)[0]?.style?.fontSize ?? 0;
      expect(check).toBeGreaterThanOrEqual(eq * 0.75);
      expect(check).toBeLessThanOrEqual(eq);
    }
  });

  test("the answer row sits on an answer plate in the accent", () => {
    const els = lay("y8").slide.elements as El[];
    const plate = named(els, WORKED_NAMES.plate);
    expect(plate).toHaveLength(1);
    expect(plate[0]?.revealStep).toBe(3);
    const right = named(els, WORKED_NAMES.right).at(-1) as El;
    expect(JSON.stringify(right.doc)).toContain(getTheme("paper").colors.accent);
  });

  test("a move's verb, its first number and 'by' are red; the rest is ink", () => {
    expect(moveHot("Subtract 5 from both sides")).toEqual([true, true, false, false, false]);
    expect(moveHot("Divide both sides by 3")).toEqual([true, false, false, true, true]);
    expect(moveHot("Add 24 and 4")).toEqual([true, true, false, false]);
    expect(moveHot("Multiply out the bracket")).toEqual([true, true, false, false]);
  });
});

describe("worked example: maths typesetting (W-d6)", () => {
  test("a hyphen used as a minus is U+2212, units sit on no-break spaces, M_r is Mr", () => {
    expect(mathText("4(x - 3) = 2x + 6")).toBe(`4(x ${NEG} 3) = 2x + 6`);
    expect(mathText("x = -5")).toBe(`x = ${NEG}5`);
    expect(mathText("n = 0.5 mol")).toBe("n = 0.5 mol");
    expect(mathText("*0.5* × 44 = 22 g")).toBe("*0.5* × 44 = 22 g");
    expect(mathText("M_r = 44")).toBe("Mr = 44");
    expect(mathText("Work out the 12-year-old's age")).toBe("Work out the 12-year-old's age");
  });
  // Variables are math runs: the theme's maths face, which is its quote face unless the theme names
  // one (Geometric's Source Serif italic, `mathFaceOf`).
  test("variables are set in the maths face, never a hyphen on the slide", () => {
    const els = lay("stress").slide.elements as El[];
    const all = els.map(words).join("");
    expect(all).not.toContain(" - ");
    expect(JSON.stringify(els)).toContain('"font":"math"');
    const moles = lay("moles")
      .slide.elements.map((e) => words(e as El))
      .join("");
    expect(moles).toContain("Mr");
    expect(moles).not.toContain("M_r");
  });
});

describe("worked example: the bar-model panel", () => {
  test("build i of the panel rides row i: the panel shows with row 1, builds from row 2", () => {
    for (const k of ["y8-panel", "y6-panel"]) {
      const r = lay(k);
      const img = r.slide.elements.find(
        (e) => e.type === "image" && (e as { builds?: number }).builds,
      ) as { revealStep?: number; buildFrom?: number; builds?: number } | undefined;
      expect(img?.revealStep).toBe(1);
      expect(img?.buildFrom).toBe(2);
      const rows = named(r.slide.elements as El[], WORKED_NAMES.badge).length;
      // The opening frame and one build per later row: no step past the last row.
      expect((img?.builds ?? 0) + 1).toBe(rows);
      expect(slideStepCount(r.slide as Slide)).toBe(rows);
      expect(named(r.slide.elements as El[], WORKED_NAMES.field)).toHaveLength(1);
    }
  });
  test("the guard falls back to the text-only base (and so does a frame count off the rows)", () => {
    const base = WORKED_CASES["y8-panel"]?.input as TemplateInput;
    for (const bad of [
      { ...base, barPanel: { model: "algebra-bar" as const, a: 9, b: 5, c: 20 } },
      { ...base, barPanel: { model: "percent-bar" as const, amount: 80, percent: 33 } },
      { ...base, check: undefined },
    ]) {
      expect(panelDraws(bad)).toBe(false);
      const r = layoutTemplate(bad, getTheme("paper"), "ks3");
      expect(r.over).toEqual([]);
      expect(named(r.slide.elements as El[], WORKED_NAMES.field)).toHaveLength(0);
      expect(
        r.slide.elements.some((e) => e.type === "image" && (e as { builds?: number }).builds),
      ).toBe(false);
    }
  });
});

describe("worked example: caps and continuation", () => {
  test("worked-capacity.json is what the renderer measures", () => {
    expect(measureWorkedCapacity()).toEqual(CAPACITY);
  });
  test("past the rows a slide holds, the working continues on a second slide", () => {
    const base = WORKED_CASES.stress?.input as TemplateInput;
    const many = {
      ...base,
      lines: [...(base.lines ?? []).slice(0, 4), ...(base.lines ?? []).slice(1)],
    };
    expect(layoutTemplate(many, getTheme("paper"), "ks3").over.join()).toContain("worked rows");
    const parts = splitWorked(many, "ks3");
    expect(parts.length).toBe(2);
    expect(parts.flatMap((p) => p.lines ?? [])).toEqual(many.lines ?? []);
    expect(parts[1]?.heading).toContain("(continued)");
    expect(parts[1]?.check).toBe(many.check);
    for (const p of parts) expect(layoutTemplate(p, getTheme("paper"), "ks3").over).toEqual([]);
    expect(splitWorked(base, "ks3")).toEqual([base]);
    expect(workedMax("ks3")).toBe(6);
    expect(workedMax("ks2")).toBe(5);
    expect(workedMax("ks3", true)).toBe(4);
  });
  test("on every theme and stage the gold cases hold the floor and stay on the slide", () => {
    const faults: string[] = [];
    for (const theme of THEMES)
      for (const [k, c] of Object.entries(WORKED_CASES)) {
        const r = layoutTemplate(c.input, theme, c.stage);
        for (const o of r.over) faults.push(`${theme.id} ${k} over ${o}`);
        for (const e of r.slide.elements as El[]) {
          const size =
            e.style?.fontSize ?? (e as { textStyle?: { fontSize?: number } }).textStyle?.fontSize;
          if (size !== undefined && size < MIN_FONT_SIZE.body)
            faults.push(`${theme.id} ${k} ${e.name} ${size}`);
          if (e.x < 0 || e.y < 0 || e.x + e.w > 960.5 || e.y + e.h > 540.5)
            faults.push(`${theme.id} ${k} ${e.name} off the slide`);
        }
        void atKeyStage;
      }
    expect(faults).toEqual([]);
  });
});

// v4.18c Equations (TEACH-247 part bl): rounding x and w each on its own turned an 82.5 pt row
// pitch into Move rows at y175 h83 and y257, 1 px over, and checks.ts called it an overlap.
describe("worked example: boxes that touch share an edge", () => {
  test("snap rounds edges, not sizes", () => {
    const a = snap({ x: 392.4, y: 174.5, w: 46.5, h: 82.5 });
    const b = snap({ x: 438.9, y: 257, w: 100, h: 82.5 });
    expect(a.y + a.h).toBe(b.y);
    expect(a.x + a.w).toBe(b.x);
  });
  const boxes = (els: readonly El[], n: string) =>
    named(els, n).map((e) => ({ x: e.x, y: e.y, w: e.w, h: e.h }));
  type Box = { x: number; y: number; w: number; h: number };
  const over = (A: Box, B: Box) =>
    Math.min(A.x + A.w, B.x + B.w) > Math.max(A.x, B.x) &&
    Math.min(A.y + A.h, B.y + B.h) > Math.max(A.y, B.y);
  for (const k of Object.keys(WORKED_CASES))
    test(`${k}: no Move row or arrow overlaps another, in any theme`, () => {
      for (const t of THEMES) {
        const els = lay(k, t).slide.elements as El[];
        const all = [...boxes(els, WORKED_NAMES.move), ...boxes(els, WORKED_NAMES.arrow)];
        for (let i = 0; i < all.length; i++)
          for (let j = i + 1; j < all.length; j++)
            expect({ k, t: t.id, i, j, over: over(all[i] as Box, all[j] as Box) }).toMatchObject({
              over: false,
            });
      }
    });
});
