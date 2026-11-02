import { describe, expect, test } from "bun:test";
import { type Slide, slideStepCount } from "@tj/domain/documents";
import { barPanelSpec } from "../diagrams/bar-model";
import { diagramElement, svgOfDataUrl } from "../diagrams/index";
import { atKeyStage, getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import {
  mathText,
  moveHot,
  panelDraws,
  panelLost,
  problemEquation,
  snap,
  splitWorked,
  WORKED_NAMES,
  workedFrames,
  workedLines,
  workedMax,
  workedPanelFrom,
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
      // A row the bar model cannot picture (no move, an equation of another problem).
      { ...base, lines: [{ eq: "3x + 5 = 20" }, { eq: "y = 7" }] },
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

/*
 * TEACH-247 part ch: the equation panel's frames fit the rows the slide shows (2, 3 or 4), the
 * panel is derived from the maths when the writer set none, x/a + b = c has its own bar, and a
 * panel that cannot draw says why (a `diagram` fault) instead of dropping silently.
 */
describe("worked example: the bar model fits the rows shown (TEACH-247 part ch)", () => {
  const solve = (over: Partial<TemplateInput> = {}): TemplateInput => ({
    template: "worked",
    heading: "Solve 3x + 5 = 20",
    lines: [
      { move: "Subtract 5 from both sides", eq: "3x = 15" },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ],
    barPanel: { model: "algebra-bar", a: 3, b: 5, c: 20 },
    ...over,
  });
  const panelOfSlide = (input: TemplateInput) => {
    const r = layoutTemplate(input, getTheme("paper"), "ks3");
    const img = r.slide.elements.find(
      (e) => e.type === "image" && (e as { builds?: number }).builds,
    ) as { revealStep?: number; buildFrom?: number; builds?: number; src: string } | undefined;
    return { r, img };
  };
  // The rows the slide shows: the problem's opening row (TEACH-247 part cm), the lines, the check.
  const rowsOf = (input: TemplateInput) =>
    workedLines(input).length + (input.check?.trim() ? 1 : 0);

  test("2 lines (the equations-C slide): the problem opens as row 1, take then share", () => {
    const input = solve();
    // TEACH-247 part cm: row 1 is the heading's equation, so the whole rides row 1.
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "share"],
      lead: false,
    });
    const { r, img } = panelOfSlide(input);
    expect(r.diagram).toBeUndefined();
    expect(r.over).toEqual([]);
    expect(img?.revealStep).toBe(1);
    expect(img?.buildFrom).toBe(2);
    expect(img?.builds).toBe(2);
    expect(rowsOf(input)).toBe(3);
    expect(slideStepCount(r.slide as Slide)).toBe(rowsOf(input));
    expect(named(r.slide.elements as El[], WORKED_NAMES.field)).toHaveLength(1);
  });

  test("a heading with no equation: the whole opens with the heading, build i with row i", () => {
    const input = solve({ heading: "Solve for x" });
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "share"],
      lead: true,
    });
    const { r, img } = panelOfSlide(input);
    expect(r.diagram).toBeUndefined();
    expect(r.over).toEqual([]);
    // Shown from the start (no reveal step), build i with row i.
    expect(img?.revealStep).toBeUndefined();
    expect(img?.buildFrom).toBe(1);
    expect(img?.builds).toBe(2);
    expect(slideStepCount(r.slide as Slide)).toBe(rowsOf(input));
  });

  test("2 lines and the check: whole, take, share, check, one per row", () => {
    const input = solve({ check: "3 × *5* + 5 = 20" });
    const f = workedFrames(input);
    expect(f).toEqual({ ok: true, frames: ["whole", "take", "share", "check"], lead: false });
    const { r, img } = panelOfSlide(input);
    expect(r.diagram).toBeUndefined();
    expect(img?.builds).toBe(3);
    expect(slideStepCount(r.slide as Slide)).toBe(rowsOf(input));
  });

  test("3 rows starting on the equation: the panel shows with row 1, no opening frame", () => {
    const input = solve({
      lines: [
        { eq: "3x + 5 = 20" },
        { move: "Subtract 5 from both sides", eq: "3x = 15" },
        { move: "Divide both sides by 3", eq: "x = 5", answer: true },
      ],
    });
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "share"],
      lead: false,
    });
    const { img } = panelOfSlide(input);
    expect(img?.revealStep).toBe(1);
    expect(img?.buildFrom).toBe(2);
    expect(img?.builds).toBe(2);
  });

  test("4 rows (the gold: equation, two moves, check) keep the four frames, one per row", () => {
    const input = WORKED_CASES["y8-panel"]?.input as TemplateInput;
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "share", "check"],
      lead: false,
    });
  });

  test("a row that restates the move (3x/3 = 15/3) holds the share frame before x = 5", () => {
    const input = solve({
      lines: [
        { move: "Subtract 5 from both sides", eq: "3x = 15" },
        { move: "Divide both sides by 3", eq: "3x/3 = 15/3" },
        { eq: "x = 5", answer: true },
      ],
    });
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "share", "share"],
      lead: false,
    });
    expect(panelDraws(input)).toBe(true);
  });

  test("x/a + b = c draws its own bar: take 3, then scale one part up to x", () => {
    const input = solve({
      heading: "Solve x/4 + 3 = 8",
      lines: [
        { move: "Subtract 3 from both sides", eq: "x/4 = 5" },
        { move: "Multiply both sides by 4", eq: "x = 20", answer: true },
      ],
      barPanel: { model: "division-bar", a: 4, b: 3, c: 8 },
    });
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "scale"],
      lead: false,
    });
    const { r, img } = panelOfSlide(input);
    expect(r.diagram).toBeUndefined();
    expect(img?.builds).toBe(2);
    expect(decodeURIComponent(img?.src ?? "")).toContain("x/4");
  });

  test("the panel is derived from the maths when the writer set none", () => {
    expect(workedPanelFrom({ heading: "Solve 3x + 5 = 20" })).toEqual({
      model: "algebra-bar",
      a: 3,
      b: 5,
      c: 20,
    });
    expect(workedPanelFrom({ heading: "Solve x/4 + 3 = 8" })).toEqual({
      model: "division-bar",
      a: 4,
      b: 3,
      c: 8,
    });
    expect(workedPanelFrom({ heading: "Solve for y", lines: [{ eq: "2y + 1 = 9" }] })).toEqual({
      model: "algebra-bar",
      a: 2,
      b: 1,
      c: 9,
    });
    // No bar-model form: brackets, x on both sides, a subtraction.
    expect(workedPanelFrom({ heading: "Solve 4(x - 3) = 2x + 6" })).toBeUndefined();
    expect(workedPanelFrom({ heading: "Solve 2x - 3 = 7" })).toBeUndefined();
    expect(workedPanelFrom({ heading: "Find 35% of 80" })).toBeUndefined();
  });

  test("a panel that cannot draw says why: a diagram fault, never a silent drop", () => {
    const tooMany = solve({ barPanel: { model: "algebra-bar", a: 9, b: 5, c: 50 } });
    expect(panelLost(tooMany)).toContain("a is not a whole number");
    expect(panelOfSlide(tooMany).r.diagram?.join()).toContain("worked panel:");
    const thirds = solve({
      heading: "Solve 3x + 5 = 15",
      barPanel: { model: "algebra-bar", a: 3, b: 5, c: 15 },
    });
    expect(panelOfSlide(thirds).r.diagram?.join()).toContain("worked panel:");
    const offRows = solve({ lines: [{ eq: "y = 7" }] });
    expect(panelLost(offRows)).toContain("cannot picture row 1");
    expect(panelOfSlide(offRows).img).toBeUndefined();
    // No panel and no equation: nothing to say.
    expect(panelLost(solve({ barPanel: undefined }))).toBeUndefined();
  });
});

/*
 * TEACH-247 part ch (review): every frame of the panel pictures the equation of the row it rides,
 * both sides. Each frame is drawn alone and read back: a solid cell is a term (a number, the
 * letter, or x/a; a cell holding a number reads as that number), a dashed cell is b taken from
 * both sides and must stand on both bars. The top bar is the left side, the bottom the right.
 */
describe("worked example: each build pictures its row's equation (TEACH-247 part ch)", () => {
  type Lin = { x: number; k: number };
  const add = (a: Lin, b: Lin): Lin => ({ x: a.x + b.x, k: a.k + b.k });
  const term = (t: string): Lin => {
    const m = /^(\d*(?:\.\d+)?)([a-z])?(?:\/(\d+))?$/.exec(t);
    if (!m) throw new Error(`term ${t}`);
    const [, co, v, d] = m;
    if (!v) return { x: 0, k: Number(co) };
    return { x: (co ? Number(co) : 1) / (d ? Number(d) : 1), k: 0 };
  };
  const side = (s: string) =>
    s.replace(/\s+/g, "").split("+").map(term).reduce(add, { x: 0, k: 0 });
  const rowEq = (eq: string) => {
    const [l, r] = eq.split("=");
    return { l: side(l ?? ""), r: side(r ?? "") };
  };
  /** The bars of one frame, read back from its drawing. */
  const picture = (panel: Record<string, unknown>, key: string) => {
    const made = barPanelSpec({ ...panel, frames: [key] } as never, "t");
    if (!made.ok) throw new Error(made.reason);
    const img = diagramElement(made.spec, getTheme("paper"), { x: 0, y: 0, w: 300, h: 370 });
    const svg = svgOfDataUrl(img?.src ?? "") ?? "";
    // Each cell's outline (a solid cell) or dashed box (b taken), as x, y, w, h.
    const rects = [...svg.matchAll(/<rect ([^>]*)\/>/g)]
      .map((m) => m[1] as string)
      .filter((r) => /fill="none"/.test(r) && /stroke=/.test(r));
    const geo = (r: string) =>
      ["x", "y", "width", "height"].map((k) => Number(new RegExp(`${k}="([\\d.]+)"`).exec(r)?.[1]));
    const solid = rects.filter((r) => !/dasharray/.test(r)).map(geo);
    const ghosts = rects.filter((r) => /dasharray/.test(r)).map(geo);
    const texts = [...svg.matchAll(/<tspan x="([\d.]+)" y="([\d.]+)">([^<]+)<\/tspan>/g)].map(
      (m) => ({ x: Number(m[1]), y: Number(m[2]), t: m[3] as string }),
    );
    const inside = (b: number[], t: { x: number; y: number }) =>
      t.x > (b[0] ?? 0) &&
      t.x < (b[0] ?? 0) + (b[2] ?? 0) &&
      t.y > (b[1] ?? 0) &&
      t.y < (b[1] ?? 0) + (b[3] ?? 0) + 2;
    const ys = [...solid, ...ghosts].map((b) => b[1] ?? 0);
    const mid = (Math.max(...ys) + Math.min(...ys)) / 2;
    const bars: Record<"top" | "bottom", Lin> = { top: { x: 0, k: 0 }, bottom: { x: 0, k: 0 } };
    const taken = { top: [] as string[], bottom: [] as string[] } as Record<string, string[]>;
    for (const b of solid) {
      const ts = texts.filter((t) => inside(b, t)).map((t) => t.t);
      const n = ts.find((t) => /^\d/.test(t));
      const row = (b[1] ?? 0) > mid ? "bottom" : "top";
      bars[row] = add(bars[row], term(n ?? (ts[0] as string)));
    }
    for (const b of ghosts) {
      const row = (b[1] ?? 0) > mid ? "bottom" : "top";
      taken[row]?.push(
        texts
          .filter((t) => inside(b, t))
          .map((t) => t.t)
          .join(""),
      );
    }
    return { ...bars, taken, tick: svg.includes("stroke-linejoin") && key === "check" };
  };
  const cases: { name: string; input: TemplateInput; panel: Record<string, unknown>; x: number }[] =
    [
      {
        name: "3x + 5 = 20, 2 rows",
        input: {
          template: "worked",
          heading: "Solve 3x + 5 = 20",
          lines: [
            { move: "Subtract 5 from both sides", eq: "3x = 15" },
            { move: "Divide both sides by 3", eq: "x = 5" },
          ],
          barPanel: { model: "algebra-bar", a: 3, b: 5, c: 20 },
        },
        panel: { model: "equation", a: 3, b: 5, c: 20 },
        x: 5,
      },
      {
        name: "3x + 5 = 20, gold 4 rows",
        input: WORKED_CASES["y8-panel"]?.input as TemplateInput,
        panel: { model: "equation", a: 3, b: 5, c: 20 },
        x: 5,
      },
      {
        name: "x/4 + 3 = 8, 2 rows + check",
        input: {
          template: "worked",
          heading: "Solve x/4 + 3 = 8",
          lines: [
            { move: "Subtract 3 from both sides", eq: "x/4 = 5" },
            { move: "Multiply both sides by 4", eq: "x = 20" },
          ],
          check: "*20*/4 + 3 = 8",
          barPanel: { model: "division-bar", a: 4, b: 3, c: 8 },
        },
        panel: { model: "equation", a: 4, b: 3, c: 8, over: true },
        x: 20,
      },
    ];
  for (const k of cases)
    test(`${k.name}: build i shows row i's equation, both sides`, () => {
      const f = workedFrames(k.input);
      if (!f.ok) throw new Error(f.reason);
      // The rows the slide shows (the problem's opening row among them, TEACH-247 part cm).
      const rows = [
        ...(f.lead ? [k.input.heading] : []),
        ...workedLines(k.input).map((l) => l.eq),
        ...(k.input.check ? ["check"] : []),
      ];
      expect(rows).toHaveLength(f.frames.length);
      f.frames.forEach((key, i) => {
        const pic = picture(k.panel, key);
        // Whatever is taken is taken from both sides.
        expect(pic.taken.top).toEqual(pic.taken.bottom);
        const row = rows[i] as string;
        if (row === "check") {
          // Every term a number: the left side's values make the right side, ticked.
          expect(pic.top?.x).toBe(0);
          expect(pic.top?.k).toBe(pic.bottom?.k);
          return;
        }
        const want = rowEq(row.replace(/^Solve\s+/, ""));
        const got = { l: pic.top as Lin, r: pic.bottom as Lin };
        if (key === "share" || key === "scale") {
          // The share pictures the whole of x (or of ax) cut into its equal values: the row's
          // equation times the number of cells, and the same answer.
          const s = got.l.x / want.l.x;
          expect(got.r.k).toBeCloseTo(want.r.k * s);
          expect(got.l.k).toBe(0);
          expect(got.r.k / got.l.x).toBeCloseTo(k.x);
        } else expect(got).toEqual(want);
      });
    });
});

/*
 * TEACH-247 part ch (review 2): a panel is derived only from a whole equation of a form the bar
 * model draws, and a row's frame is proven from its own equation; anything else draws no panel.
 */
describe("worked example: no wrong bar model (TEACH-247 part ch)", () => {
  test("only a whole ax + b = c or x/a + b = c derives a panel", () => {
    for (const h of [
      "Solve −3x + 5 = 20",
      "Solve 10 − 3x + 5 = 20",
      "Solve 5 + 2x + 3 = 20",
      "Solve 3x + 5 = 20 + x",
      "Solve x + 3 = 20 − 4",
      "Solve 2x + 3 = 11 ÷ 2",
      "−3x + 5 = 20",
      "10 − 3x + 5 = 20",
      "5 + 2x + 3 = 20",
      "3x + 5 = 20 + x",
      "x + 3 = 20 − 4",
      "2x + 3 = 11 ÷ 2",
    ])
      expect({ h, p: workedPanelFrom({ heading: h }) }).toEqual({ h, p: undefined });
    const bar = { model: "algebra-bar" as const, a: 3, b: 5, c: 20 };
    expect(workedPanelFrom({ heading: "Solve 3x + 5 = 20." })).toEqual(bar);
    expect(workedPanelFrom({ heading: "Solve for x: 3x + 5 = 20" })).toEqual(bar);
    expect(workedPanelFrom({ heading: "3x + 5 = 20" })).toEqual(bar);
    expect(workedPanelFrom({ heading: "Solve x ÷ 4 + 3 = 8!" })).toEqual({
      model: "division-bar",
      a: 4,
      b: 3,
      c: 8,
    });
  });
  const slide = (
    heading: string,
    barPanel: TemplateInput["barPanel"],
    lines: TemplateInput["lines"],
  ) => ({ template: "worked", heading, barPanel, lines }) as TemplateInput;
  test("a row whose own equation is another equation is never pictured from its move", () => {
    const s = slide("Solve 2x + 3 = 11", { model: "algebra-bar", a: 2, b: 3, c: 11 }, [
      { move: "Divide both sides by 2", eq: "x + 1.5 = 5.5" },
      { move: "Subtract 1.5 from both sides", eq: "x = 4", answer: true },
    ]);
    expect(workedFrames(s).ok).toBe(false);
    expect(panelDraws(s)).toBe(false);
    // Row 1 is the problem (TEACH-247 part cm); the writer's first line is row 2.
    expect(panelLost(s)).toContain("cannot picture row 2");
    const r = layoutTemplate(s, getTheme("paper"), "ks3");
    expect(r.diagram?.join()).toContain("worked panel:");
  });
  test("a move is read only when its row does not parse, and only with its own number", () => {
    const base = { model: "algebra-bar" as const, a: 3, b: 5, c: 20 };
    // "Subtract x" names no b: not the take.
    const subX = slide("Solve 3x + 5 = 20", base, [
      { move: "Subtract x from both sides", eq: "3x + 5 − x = 20 − x ..." },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ]);
    expect(workedFrames(subX).ok).toBe(false);
    // An unparsed row with "Subtract 5" is the take.
    const sub5 = slide("Solve 3x + 5 = 20", base, [
      { move: "Subtract 5 from both sides", eq: "3x + 5 − 5 = 20 − 5 (so 3x = 15)" },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ]);
    expect(workedFrames(sub5)).toEqual({
      ok: true,
      frames: ["whole", "take", "share"],
      lead: false,
    });
    // A parsed row that is the take by its equation, whatever its move says.
    const ok = slide("Solve 3x + 5 = 20", base, [
      { move: "Take 5 away", eq: "3x + 5 − 5 = 20 − 5" },
      { eq: "x = 5", answer: true },
    ]);
    expect(workedFrames(ok)).toEqual({ ok: true, frames: ["whole", "take", "share"], lead: false });
  });
});

/*
 * TEACH-247 part cm: the writer is told "each row the move in words, then the equation it gives"
 * and that the heading is the problem, so its row 1 carries a move ("Subtract 5 from both sides",
 * "3x = 15"). The slide used to draw no move on row 1: the first step was lost on every equations
 * deck. Every written move is now drawn: the working opens on the problem's equation (read from the
 * heading) and a move with no line above it leads from the heading.
 */
describe("worked example: a written move is never lost (TEACH-247 part cm)", () => {
  const text = (e: El) =>
    [...JSON.stringify(e.doc ?? "").matchAll(/"text":"([^"]*)"/g)].map((m) => m[1]).join("");
  const writer = (over: Partial<TemplateInput> = {}): TemplateInput => ({
    template: "worked",
    heading: "Solve 3x + 5 = 20",
    lines: [
      { move: "Subtract 5 from both sides", eq: "3x = 15" },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ],
    ...over,
  });
  const fraction = writer({
    heading: "Find ⅔ of 24",
    vars: [],
    lines: [
      { move: "Divide by the denominator, 3", eq: "24 ÷ 3 = 8" },
      { move: "Multiply by the numerator, 2", eq: "8 × 2 = 16", answer: true },
    ],
  });
  const check = writer({
    heading: "Check x = 6 in 2x + 3 = 15",
    lines: [
      { move: "Substitute 6 for x", eq: "2(6) + 3" },
      { move: "Calculate the left side", eq: "12 + 3 = 15" },
      { move: "Compare with the right side", eq: "15 = 15, so x = 6 is a solution", answer: true },
    ],
  });
  const started = writer({
    lines: [
      { move: "Start with the equation", eq: "3x + 5 = 20" },
      { move: "Subtract 5 from both sides", eq: "3x = 15" },
      { move: "Divide both sides by 3", eq: "x = 5", answer: true },
    ],
  });
  const word = writer({
    heading: "Mass falls from 50 g to 46 g in 20 s",
    vars: [],
    lines: [
      { move: "Find the mass lost", eq: "50 - 46 = 4 g" },
      { move: "Divide by the time", eq: "4 g ÷ 20 s = 0.2 g/s", answer: true },
    ],
  });
  const movesOf = (input: TemplateInput) =>
    (input.lines ?? []).flatMap((l) => (l.move?.trim() ? [mathText(l.move.trim())] : []));
  const drawnMoves = (els: readonly El[]) => named(els, WORKED_NAMES.move).map(text);

  test("the problem's equation is the one the heading states, after its words", () => {
    expect(problemEquation("Solve 3x + 5 = 20")).toBe("3x + 5 = 20");
    expect(problemEquation("Solve x/4 + 3 = 8.")).toBe("x/4 + 3 = 8");
    expect(problemEquation("Solve for x: 3x − 4 = −10")).toBe("3x − 4 = −10");
    expect(problemEquation("Check x = 6 in 2x + 3 = 15")).toBe("2x + 3 = 15");
    expect(problemEquation("Solve 4(x - 3) = 2x + 6")).toBe("4(x - 3) = 2x + 6");
    // No equation: a quantity, a word problem, a question, a continued slide.
    expect(problemEquation("Find ⅔ of 24")).toBeUndefined();
    expect(problemEquation("Mass falls from 50 g to 46 g in 20 s")).toBeUndefined();
    expect(problemEquation("How many moles are in 22 g of CO₂?")).toBeUndefined();
    expect(problemEquation("Solve 3x + 5 = 20 (continued)")).toBeUndefined();
  });

  test("the writer's rows: the working opens on the problem, then each move on its own row", () => {
    const r = layoutTemplate(writer(), getTheme("paper"), "ks3");
    const els = r.slide.elements as El[];
    expect(r.over).toEqual([]);
    expect(drawnMoves(els)).toEqual(movesOf(writer()));
    // Row 1 is the problem's equation, then the two rows the writer wrote: one click a row.
    const lefts = named(els, WORKED_NAMES.left).map(text);
    const rights = named(els, WORKED_NAMES.right).map(text);
    expect(lefts).toEqual(["3x + 5", "3x", "x"]);
    expect(rights).toEqual(["20", "15", "5"]);
    expect(slideStepCount(r.slide as Slide)).toBe(3);
    // "Subtract 5" leads from row 1 to row 2, on row 2's click, with its arrow.
    const [m1, m2] = named(els, WORKED_NAMES.move);
    expect(m1?.revealStep).toBe(2);
    expect(m2?.revealStep).toBe(3);
    for (const m of [m1, m2])
      expect(named(els, WORKED_NAMES.arrow).some((a) => a.revealStep === m?.revealStep)).toBe(true);
    // The field counters keep the writer's own path for its first move.
    expect(r.fields?.map((f) => f.path)).toContain("lines.0.move");
    expect(r.fields?.find((f) => f.path === "lines.0.move")?.chars).toBe(
      "Subtract 5 from both sides".length,
    );
  });

  test("with its bar model the problem's row is the panel's whole, shown with row 1", () => {
    const input = writer({ barPanel: { model: "algebra-bar", a: 3, b: 5, c: 20 } });
    expect(workedFrames(input)).toEqual({
      ok: true,
      frames: ["whole", "take", "share"],
      lead: false,
    });
    const r = layoutTemplate(input, getTheme("paper"), "ks3");
    expect(r.over).toEqual([]);
    expect(r.diagram).toBeUndefined();
    expect(drawnMoves(r.slide.elements as El[])).toEqual(movesOf(input));
    const img = r.slide.elements.find(
      (e) => e.type === "image" && (e as { builds?: number }).builds,
    ) as { revealStep?: number; buildFrom?: number; builds?: number } | undefined;
    expect(img?.revealStep).toBe(1);
    expect(img?.buildFrom).toBe(2);
    expect(img?.builds).toBe(2);
    expect(slideStepCount(r.slide as Slide)).toBe(3);
  });

  test("a heading with no equation: move 1 leads from the heading to row 1, on row 1's click", () => {
    for (const input of [fraction, word]) {
      const r = layoutTemplate(input, getTheme("paper"), "ks3");
      const els = r.slide.elements as El[];
      expect(r.over).toEqual([]);
      expect(drawnMoves(els)).toEqual(movesOf(input));
      expect(named(els, WORKED_NAMES.sign)).toHaveLength(2);
      const heading = els.find((e) => e.name === "Heading") as El;
      const row1 = named(els, WORKED_NAMES.left)[0] as El;
      const move1 = named(els, WORKED_NAMES.move)[0] as El;
      const arrow1 = named(els, WORKED_NAMES.arrow)[0] as El;
      expect(move1.revealStep).toBe(1);
      expect(arrow1.revealStep).toBe(1);
      // Under the heading, ending at row 1's middle; beside the equations, never over them.
      for (const e of [move1, arrow1]) {
        expect(e.y).toBeGreaterThanOrEqual(heading.y + heading.h - 1);
        expect(e.y + e.h).toBeLessThanOrEqual(row1.y + row1.h / 2 + 1);
        expect(e.x).toBeGreaterThanOrEqual(row1.x + row1.w);
      }
    }
  });

  test("a row 1 that is the problem keeps its move, and the problem is not shown twice", () => {
    const r = layoutTemplate(started, getTheme("paper"), "ks3");
    const els = r.slide.elements as El[];
    expect(r.over).toEqual([]);
    expect(named(els, WORKED_NAMES.sign)).toHaveLength(3);
    expect(drawnMoves(els)).toEqual(movesOf(started));
  });

  test("a substitution check opens on the equation it checks", () => {
    const r = layoutTemplate(check, getTheme("paper"), "ks3");
    const els = r.slide.elements as El[];
    expect(drawnMoves(els)).toEqual(movesOf(check));
    expect(named(els, WORKED_NAMES.left).map(text)[0]).toBe("2x + 3");
  });

  test("past the rows a slide holds, the continued slide's first move is still drawn", () => {
    const long = writer({
      heading: "Solve 4(x - 3) = 2x + 6",
      lines: [
        { move: "Expand the bracket", eq: "4x - 12 = 2x + 6" },
        { move: "Subtract 2x from both sides", eq: "2x - 12 = 6" },
        { move: "Add 12 to both sides", eq: "2x = 18" },
        { move: "Divide both sides by 2", eq: "x = 9" },
        { move: "Write the solution", eq: "x = 9", answer: true },
      ],
      check: "4(*9* - 3) = 24 = 2 × *9* + 6",
    });
    const parts = splitWorked(long, "ks3");
    expect(parts.length).toBe(2);
    const drawn: string[] = [];
    for (const p of parts) {
      const r = layoutTemplate(p, getTheme("paper"), "ks3");
      expect(r.over).toEqual([]);
      drawn.push(...drawnMoves(r.slide.elements as El[]));
    }
    expect(drawn).toEqual(movesOf(long));
  });

  test("on every theme and stage, every written move is on the slide", () => {
    const lost: string[] = [];
    const stages: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
    for (const theme of THEMES)
      for (const stage of stages)
        for (const [k, input] of Object.entries({ writer, fraction, check, started, word })) {
          const i = typeof input === "function" ? input() : input;
          for (const p of splitWorked(i, stage)) {
            const r = layoutTemplate(p, theme, stage);
            const els = r.slide.elements as El[];
            const want = movesOf(p);
            const got = drawnMoves(els);
            if (JSON.stringify(got) !== JSON.stringify(want))
              lost.push(`${theme.id} ${stage} ${k}: ${got.length}/${want.length} moves drawn`);
            for (const e of els)
              if (e.x < 0 || e.y < 0 || e.x + e.w > 960.5 || e.y + e.h > 540.5)
                lost.push(`${theme.id} ${stage} ${k} ${e.name} off the slide`);
          }
        }
    expect(lost).toEqual([]);
  });
});
