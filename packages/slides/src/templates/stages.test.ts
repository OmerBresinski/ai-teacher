import { describe, expect, test } from "bun:test";
import type { PathElement, ShapeElement, SlideElement } from "@tj/domain/documents";
import { loadIcons } from "../icons/loader";
import { blockArrow } from "../paths/arrow";
import { addItem, relayout, removeItem } from "../relayout";
import { resolveTextStyle } from "../text-style";
import { atKeyStage, getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import { layoutTemplate, mix, type Stage, type TemplateInput } from "./index";
import { ROW_NAMES } from "./items-row";
import { v2Colors } from "./items-row-deps";
import { STAGES_NAMES, stagesPaths } from "./stages";
import { measureCell } from "./stages-capacity";
import CAPACITY from "./stages-capacity.json" with { type: "json" };
import { STAGE_CASES } from "./stages-fixtures";

/*
 * TEACH-75 part ac (C4): stages, 3-6 named frames joined by block arrows (gold
 * `northstars-v12/stages-arrows`, `?arrow=block`). Any stage with neither a picture nor an icon
 * lays the item row's ordered look (ruling 243, N7).
 */
await loadIcons();
const theme = getTheme("paper");
const lay = (input: TemplateInput, stage: Stage = "ks2", t = theme) =>
  layoutTemplate(input, t, stage);
const byName = (els: SlideElement[], name: string) => els.filter((e) => e.name === name);
const caseOf = (n: string) =>
  STAGE_CASES.find((c) => c.name.startsWith(n)) as (typeof STAGE_CASES)[number];
const overlap = (a: SlideElement, b: SlideElement) =>
  a.x < b.x + b.w - 0.5 && b.x < a.x + a.w - 0.5 && a.y < b.y + b.h - 0.5 && b.y < a.y + a.h - 0.5;

describe("stages: the gold's cases (TEACH-75 part ac)", () => {
  for (const k of STAGE_CASES)
    test(`${k.name}: nothing off-canvas, no words overlap, text at or over the floor`, () => {
      for (const t of THEMES) {
        const els = lay(k.input, k.stage, t).slide.elements;
        for (const e of els) {
          expect(e.x).toBeGreaterThanOrEqual(0);
          expect(e.x + e.w).toBeLessThanOrEqual(960.5);
          expect(e.y).toBeGreaterThanOrEqual(0);
        }
        const texts = els.filter((e) => e.type === "text");
        for (const [i, a] of texts.entries())
          for (const b of texts.slice(i + 1)) expect(overlap(a, b)).toBe(false);
        for (const e of texts)
          expect(e.style?.fontSize ?? 99).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
      }
    });

  test("in-cap cases are not over; text half again over the cap is flagged, never cut", () => {
    for (const n of ["01", "03", "04", "05", "08", "09", "10"])
      expect([n, lay(caseOf(n).input, caseOf(n).stage).over]).toEqual([n, []]);
    const over = lay(caseOf("11").input, "ks3");
    expect(over.over.length).toBeGreaterThan(0);
    expect(over.tight).toBe(true);
    const words = byName(over.slide.elements, STAGES_NAMES.line).map((e) =>
      JSON.stringify((e as { doc?: unknown }).doc),
    );
    for (const s of caseOf("11").input.stages ?? [])
      expect(words.some((w) => w.includes(s.line))).toBe(true);
  });

  test("every stored font size is the size the renderer draws", () => {
    for (const k of STAGE_CASES)
      for (const t of THEMES) {
        const th = atKeyStage(t, k.stage);
        for (const e of lay(k.input, k.stage, t).slide.elements)
          if (e.type === "text" && e.style?.fontSize)
            expect(resolveTextStyle(e.style, th, e.style.preset ?? "body").fontSize).toBe(
              e.style.fontSize,
            );
      }
  });
});

describe("stages: the strip", () => {
  const r = lay(caseOf("05").input);
  const els = r.slide.elements;
  const frames = byName(els, STAGES_NAMES.frame);
  const arrows = byName(els, STAGES_NAMES.arrow) as PathElement[];
  const halos = byName(els, STAGES_NAMES.halo) as PathElement[];

  test("five frames joined: own outer corners (closed paths) at the ends, plain rects between", () => {
    expect(frames.map((f) => f.type)).toEqual(["path", "shape", "shape", "shape", "path"]);
    expect((frames[1] as ShapeElement).shape).toBe("rect");
    for (const f of [frames[0], frames[4]]) expect((f as PathElement).closed).toBe(true);
    for (let i = 1; i < 5; i++) {
      const a = frames[i - 1] as SlideElement;
      const b = frames[i] as SlideElement;
      expect(Math.round(b.x - (a.x + a.w))).toBe(5);
      expect(b.h).toBe(a.h);
    }
  });

  test("the tint deepens from 30% to 80% of the accent's tint, left to right", () => {
    const col = v2Colors(atKeyStage(theme, "ks2"));
    const fills = frames.map((f) => (f as { fill?: string }).fill);
    expect(fills[0]).toBe(mix(col.soft, col.surface, 0.3));
    expect(fills[4]).toBe(mix(col.soft, col.surface, 0.8));
    expect(new Set(fills).size).toBe(5);
  });

  test("a closed block arrow on each seam over a paper halo, clear of every icon", () => {
    expect(arrows).toHaveLength(4);
    expect(halos).toHaveLength(4);
    const col = v2Colors(atKeyStage(theme, "ks2"));
    for (const [i, a] of arrows.entries()) {
      expect(a.closed).toBe(true);
      expect(a.points).toHaveLength(7);
      expect(a.fill).toBe(col.accent);
      expect(a.strokeWidth).toBe(0);
      const h = halos[i] as PathElement;
      expect(h.stroke).toBe(col.background);
      expect(h.strokeWidth).toBeGreaterThan(4);
      expect(els.indexOf(h)).toBeLessThan(els.indexOf(a));
      // Centred on the seam between frame i and i + 1.
      const f = frames[i] as SlideElement;
      const g = frames[i + 1] as SlideElement;
      expect(Math.abs(a.x + a.w / 2 - (f.x + f.w + g.x) / 2)).toBeLessThan(1.5);
      expect(Math.abs(a.y + a.h / 2 - (f.y + f.h / 2))).toBeLessThan(1.5);
    }
    const icons = byName(els, STAGES_NAMES.icon);
    expect(icons).toHaveLength(5);
    for (const ic of icons)
      for (const a of arrows)
        if (ic.y < a.y + a.h && a.y < ic.y + ic.h)
          expect(Math.max(a.x - (ic.x + ic.w), ic.x - (a.x + a.w))).toBeGreaterThanOrEqual(8);
  });

  test("names share the tallest name's height, so every line starts level", () => {
    const k = lay(caseOf("09").input, "ks3").slide.elements;
    const names = byName(k, STAGES_NAMES.name);
    const lines = byName(k, STAGES_NAMES.line);
    expect(new Set(names.map((n) => n.h)).size).toBe(1);
    expect(new Set(lines.map((n) => n.y)).size).toBe(1);
  });

  test("no numbers on the strip", () => {
    expect(byName(els, ROW_NAMES.numeral)).toHaveLength(0);
  });
});

describe("stages: pictures and fallbacks", () => {
  test("pictures: every stage its own rounded tile, the arrow on the paper between them", () => {
    const els = lay(caseOf("06").input).slide.elements;
    const pics = byName(els, STAGES_NAMES.picture);
    expect(pics).toHaveLength(5);
    const arrows = byName(els, STAGES_NAMES.arrow);
    for (const [i, a] of arrows.entries()) {
      const p = pics[i] as SlideElement;
      const q = pics[i + 1] as SlideElement;
      expect(a.x - (p.x + p.w)).toBeGreaterThanOrEqual(8);
      expect(q.x - (a.x + a.w)).toBeGreaterThanOrEqual(8);
    }
  });

  test("a failed picture's tile shows its icon", () => {
    const els = lay(caseOf("07").input).slide.elements;
    expect(byName(els, STAGES_NAMES.picture)).toHaveLength(3);
    expect(byName(els, STAGES_NAMES.icon)).toHaveLength(2);
  });

  test("a stage with neither lays the item row's ordered look: numbered medals, no frames", () => {
    const k = caseOf("10");
    const r = lay(k.input, "ks3");
    const els = r.slide.elements;
    expect(byName(els, STAGES_NAMES.frame)).toHaveLength(0);
    expect(byName(els, STAGES_NAMES.arrow)).toHaveLength(0);
    expect(byName(els, ROW_NAMES.numeral)).toHaveLength(6);
    expect(byName(els, ROW_NAMES.name)).toHaveLength(6);
    // Six stages are in the stages' range: the row's own four-item limit is not an over here.
    expect(r.over).toEqual([]);
    expect(r.iconMisses).toEqual(["v-shaped-valley", "oxbow-lake"]);
    expect(r.fields?.map((f) => f.path)).toContain("stages.5.line");
    // The paths bind the row's names and lines to the stages' input.
    const paths = stagesPaths(els).filter(Boolean);
    expect(paths).toContain("stages.1.name");
    expect(paths).toContain("stages.5.line");
  });

  test("a held draft icon keeps the strip, its frame empty", () => {
    const input = structuredClone(caseOf("05").input);
    (input.stages ?? [])[4] = { name: "Sell", line: "Shops sell it.", icon: "(icon pending)" };
    const els = lay(input).slide.elements;
    expect(byName(els, STAGES_NAMES.frame)).toHaveLength(5);
    expect(byName(els, STAGES_NAMES.icon)).toHaveLength(4);
  });

  test("count: fewer than 3, or more than the age's max (5 at early, 6 later), is over", () => {
    const five = caseOf("05").input;
    const two = { ...five, stages: five.stages?.slice(0, 2) };
    expect(lay(two).over).toContain("stages");
    const six = caseOf("09").input;
    expect(lay(six, "ks1").over).toContain("stages");
    expect(lay(six, "ks3").over).toEqual([]);
  });
});

describe("stages: a cap of 0 is over, never silent", () => {
  const pictured = (k: string, n: number) => {
    const input = structuredClone(caseOf(k).input);
    input.stages = (input.stages ?? []).slice(0, n).map((s) => ({
      ...s,
      picture: { photo: "https://images.test/stage.jpg", alt: s.name },
    }));
    return input;
  };
  test("5 pictures at early: measured beside short siblings (TEACH-68 part b), long words over", () => {
    // Was 0 only because the 6-letter stand-in names overflowed; the cell holds 5-letter names
    // and 24-character lines, so this case's longer ones are over and its short ones are not.
    // TEACH-215 part j: at the gold's 54 px names and 38 px lines (ruling 162 amended by Greg 18
    // Oct, stages) this cell holds 7-letter names and 44-character lines, so nothing is over; the
    // 7-letter "Harvest" is past the comfortable 6 and the slide is tight.
    const r = lay(pictured("05", 5), "ks1");
    expect(r.over).toEqual([]);
    expect(r.tight).toBe(true);
  });
  test("6 pictures at primary: 7-letter names are over (cap 6); 3 short pictured stages at early are not", () => {
    expect(lay(pictured("09", 6), "ks2").over).toContain("stages[0].name");
    expect(lay(pictured("01", 3), "ks1").over).toEqual([]);
  });
});

describe("blockArrow (the arrow primitive, TEACH-75 part ac)", () => {
  test("seven points, the tip on the shaft's line, symmetric about it", () => {
    const p = blockArrow([0, 50], [100, 50], { shaft: 40, head: 92, headLen: 44 }).map(([x, y]) => [
      x,
      y,
    ]) as [number, number][];
    expect(p).toHaveLength(7);
    expect(p[3]).toEqual([100, 50]);
    for (const [a, b] of [
      [0, 6],
      [1, 5],
      [2, 4],
    ] as const) {
      const [pa, pb] = [p[a] as [number, number], p[b] as [number, number]];
      expect(pa[0]).toBeCloseTo(pb[0], 6);
      expect(pa[1] + pb[1]).toBeCloseTo(100, 6);
    }
    expect(p[0]).toEqual([0, 30]);
    expect(p[2]).toEqual([56, 4]);
  });
});

describe("stages: caps (stages-capacity.json is what the renderer measures)", () => {
  const table = CAPACITY as unknown as Record<string, ReturnType<typeof measureCell>[]>;
  test("the table covers every age, count 3 to the age's max, icons and pictures", () => {
    expect(table.early?.map((c) => `${c.n}${c.vis[0]}`)).toEqual([
      "3i",
      "3p",
      "4i",
      "4p",
      "5i",
      "5p",
    ]);
    expect(table.secondary).toHaveLength(8);
  });
  // A full re-measure on every theme: about 2 s alone, past bun's 5 s default under CI load.
  for (const [age, n, vis] of [
    ["primary", 5, "icons"],
    ["secondary", 3, "pictures"],
  ] as const)
    test(`${age} ${n} ${vis}: renderer = table`, () => {
      expect(measureCell(age, n, vis)).toEqual(
        table[age]?.find((c) => c.n === n && c.vis === vis) as ReturnType<typeof measureCell>,
      );
    }, 60_000);
});

describe("stages: RTL (ruling 239; the mirror rows wait for part z)", () => {
  const AR: TemplateInput = {
    template: "stages",
    heading: "من القمح إلى الخبز",
    stages: [
      { name: "الزراعة", line: "يزرع المزارعون القمح.", icon: "wheat" },
      { name: "الحصاد", line: "تحصد الآلات القمح.", icon: "combine-harvester" },
      { name: "الطحن", line: "تطحن المطاحن الحبوب.", icon: "flour" },
    ],
  };
  test("Arabic stages: nothing over, off-canvas or overlapping on every theme", () => {
    for (const t of THEMES) {
      const r = lay(AR, "ks2", t);
      expect([t.id, r.over]).toEqual([t.id, []]);
      const texts = r.slide.elements.filter((e) => e.type === "text");
      for (const e of r.slide.elements) expect(e.x + e.w).toBeLessThanOrEqual(960.5);
      for (const [i, a] of texts.entries())
        for (const b of texts.slice(i + 1)) expect(overlap(a, b)).toBe(false);
    }
  });
});

describe("stages: relayout (add and remove within min..max)", () => {
  const ref = { template: "stages" as const, input: caseOf("05").input as Record<string, unknown> };
  test("add keeps the icons (a blank stage carries the placeholder) up to six; remove stops at three", () => {
    const added = addItem(ref, 5, "ks2");
    expect(added.ok).toBe(true);
    if (!added.ok) return;
    const els = relayout(added.ref, theme, "ks2").elements;
    expect(byName(els, STAGES_NAMES.frame)).toHaveLength(6);
    expect(addItem(added.ref, 6, "ks2").ok).toBe(false);
    let r = ref as typeof ref;
    for (let i = 0; i < 2; i++) {
      const c = removeItem(r, 0);
      expect(c.ok).toBe(true);
      if (c.ok) r = c.ref as typeof ref;
    }
    expect(removeItem(r, 0).ok).toBe(false);
  });

  test("ids bound to the stages' paths", () => {
    const { paths } = relayout(ref, theme, "ks2", "g");
    expect(Object.values(paths)).toContain("stages.4.line");
    expect(paths["g:stages.0.name"]).toBe("stages.0.name");
  });
});
