import { describe, expect, test } from "bun:test";
import type { SlideElement, TextElement } from "@tj/domain/documents";
import { PLACEHOLDER_IMAGE } from "../layouts";
import { contrastRatio } from "../look";
import { resolveTextStyle } from "../text-style";
import { getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import { type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";
import SET_CAPACITY from "./side-by-side-capacity.json" with { type: "json" };
import {
  SPLIT_NAMES,
  type SplitSide,
  type SplitZone,
  splitGroupOf,
  splitPaths,
  splitTable,
} from "./split-compare";
import {
  measureSplitCell,
  SPLIT_FIT_HEADING,
  SPLIT_GROUPS,
  type SplitGroup,
  splitSides,
} from "./split-compare-capacity";

/*
 * Side by side (TEACH-75 part w, Greg 14 Oct: "the compare without VS variant for variety"): 2 or
 * 3 examples of one idea as matching cards. It must never read as a contrast: one tint, a plain
 * gap, no seam marker. Its caps are measured at the drawn size on its own (narrower) cards.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const ZONES: SplitZone[] = ["picture", "text"];
const texts = (els: SlideElement[]) => els.filter((e): e is TextElement => e.type === "text");
const photo = (n: number): Figure => ({
  photo: `https://x.test/example-${n}.jpg`,
  aspect: 4 / 3,
  alt: `example ${n}`,
  subjects: [{ name: "subject", x: 0.25, y: 0.2, w: 0.5, h: 0.6 }],
});
const set = (sides: SplitSide[], heading = "Adapted to survive"): TemplateInput => ({
  template: "side-by-side",
  heading,
  sides,
});
const examples = (n: number): SplitSide[] =>
  Array.from({ length: n }, (_, i) => ({
    title: ["Rainforest leaf", "Desert cactus", "Arctic fox"][i] as string,
    text: "Its shape helps it keep or lose water.",
    picture: photo(i),
  }));
const fieldsOf = (els: SlideElement[]) => els.filter((e) => e.name === SPLIT_NAMES.field);

describe("side by side never reads as a contrast", () => {
  test("no seam marker, one tint on every card, a plain gap between cards, on every theme", () => {
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const n of [2, 3]) {
          const r = layoutTemplate(set(examples(n)), theme, stage);
          const els = r.slide.elements;
          expect(els.filter((e) => e.name === SPLIT_NAMES.marker)).toHaveLength(0);
          expect(els.filter((e) => e.name === SPLIT_NAMES.markerRing)).toHaveLength(0);
          expect(els.some((e) => e.type === "text" && /\bvs\b/.test(JSON.stringify(e)))).toBe(
            false,
          );
          const fields = fieldsOf(els);
          expect(fields).toHaveLength(n);
          expect(new Set(fields.map((f) => (f as { fill: string }).fill)).size).toBe(1);
          // Cards, not full-bleed fields: inset from the sides and foot, a gap of at least 24.
          expect(fields[0]?.x).toBeGreaterThan(19);
          const last = fields[n - 1] as SlideElement;
          expect(last.x + last.w).toBeLessThan(960 - 19);
          for (const f of fields) expect(f.y + f.h).toBeLessThan(540 - 19);
          for (let i = 1; i < n; i++) {
            const a = fields[i - 1] as SlideElement;
            expect((fields[i] as SlideElement).x - (a.x + a.w)).toBeGreaterThanOrEqual(24);
          }
          // Words read on the card at 4.5:1.
          const fill = (fields[0] as { fill: string }).fill;
          for (const e of texts(els).filter((e) => e.name === SPLIT_NAMES.text))
            expect(
              contrastRatio(e.style.color ?? theme.colors.ink, fill),
              `${theme.id}`,
            ).toBeGreaterThanOrEqual(4.5);
        }
  });

  test("setTint neutral: every card in the theme's soft neutral, words still at 4.5:1", () => {
    for (const theme of THEMES) {
      const r = layoutTemplate(set(examples(3)), theme, "ks2", { setTint: "neutral" });
      const fills = fieldsOf(r.slide.elements).map((f) => (f as { fill: string }).fill);
      expect(new Set(fills).size).toBe(1);
      const accent = fieldsOf(layoutTemplate(set(examples(3)), theme, "ks2").slide.elements);
      expect(fills[0]).not.toBe((accent[0] as { fill: string }).fill);
      for (const e of texts(r.slide.elements).filter((e) => e.name === SPLIT_NAMES.text))
        expect(
          contrastRatio(e.style.color ?? theme.colors.ink, fills[0] as string),
        ).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("split compare with the same sides still draws its contrast (fields edge to edge, vs)", () => {
    const theme = THEMES[0] as (typeof THEMES)[number];
    const r = layoutTemplate({ ...set(examples(2)), template: "split-compare" }, theme, "ks2");
    const fields = fieldsOf(r.slide.elements);
    expect(fields[0]?.x).toBe(0);
    expect(r.slide.elements.filter((e) => e.name === SPLIT_NAMES.marker)).toHaveLength(1);
    expect(new Set(fields.map((f) => (f as { fill: string }).fill)).size).toBe(2);
  });

  test("every example keeps its picture, title and words, in its own card", () => {
    const r = layoutTemplate(set(examples(3)), THEMES[0] as never, "ks3");
    const fields = fieldsOf(r.slide.elements);
    const pics = r.slide.elements.filter((e) => e.name === SPLIT_NAMES.picture);
    expect(pics).toHaveLength(3);
    for (const [i, p] of pics.entries()) {
      const f = fields[i] as SlideElement;
      expect(p.x).toBeGreaterThanOrEqual(f.x);
      expect(p.x + p.w).toBeLessThanOrEqual(f.x + f.w);
    }
    expect(splitPaths(r.slide.elements).filter(Boolean)).toEqual([
      "sides.0.title",
      "sides.0.text",
      "sides.1.title",
      "sides.1.text",
      "sides.2.title",
      "sides.2.text",
    ]);
  });
});

describe("side by side pictures span their card's column", () => {
  test("each picture has its words' left and right edges (a 2.2:1 strip at most), every theme and age", () => {
    const faults: string[] = [];
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const n of [2, 3]) {
          const els = layoutTemplate(set(examples(n)), theme, stage).slide.elements;
          const pics = els.filter((e) => e.name === SPLIT_NAMES.picture);
          const words = els.filter((e) => e.name === SPLIT_NAMES.text);
          pics.forEach((p, i) => {
            const t = words[i] as SlideElement;
            // A very short picture (KS1, three cards) stops at a 2.2:1 strip, centred on the column.
            const strip = p.w / p.h >= 2.18;
            const centred = Math.abs(p.x + p.w / 2 - (t.x + t.w / 2)) <= 1;
            if (strip ? !centred : Math.abs(p.x - t.x) > 1 || Math.abs(p.x + p.w - (t.x + t.w)) > 1)
              faults.push(`${theme.id} ${stage} ${n} card ${i}: ${p.x}+${p.w} vs ${t.x}+${t.w}`);
          });
        }
    expect(faults.slice(0, 8)).toEqual([]);
  });
});

describe("side by side at its measured caps", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: 2 and 3 cards at cap, pictures and words, nothing over`, () => {
        const faults: string[] = [];
        for (const n of [2, 3] as const)
          for (const zone of ZONES) {
            const sides = splitSides(splitGroupOf(stage), n, zone, "side-by-side");
            const r = layoutTemplate(set(sides, SPLIT_FIT_HEADING), theme, stage);
            const tag = `${n} ${zone}`;
            for (const o of r.over) faults.push(`${tag} over ${o}`);
            const never = Object.values(
              splitTable(splitGroupOf(stage), n, zone, "side-by-side"),
            ).some((l) => !l.cap);
            if (r.tight !== never) faults.push(`${tag} tight ${r.tight}`);
            for (const e of r.slide.elements)
              if (e.y + e.h > 540 + 0.5) faults.push(`${tag} ${e.name} past the foot`);
            for (const e of texts(r.slide.elements))
              if ((e.style.fontSize ?? 0) < MIN_FONT_SIZE.body)
                faults.push(`${tag} ${e.name} ${e.style.fontSize}`);
          }
        expect(faults).toEqual([]);
      });

  test("every text box stores the size the renderer draws (the age's reading floor holds)", () => {
    const faults: string[] = [];
    for (const theme of THEMES)
      for (const stage of STAGES) {
        const drawnTheme = getTheme(theme.id, stage);
        for (const n of [2, 3] as const)
          for (const zone of ZONES) {
            const sides = splitSides(splitGroupOf(stage), n, zone, "side-by-side");
            const r = layoutTemplate(set(sides, SPLIT_FIT_HEADING), theme, stage);
            for (const e of texts(r.slide.elements)) {
              if (e.style.fontSize === undefined || e.name === "Heading") continue;
              const drawn = resolveTextStyle(e.style, drawnTheme, e.style.preset).fontSize;
              if (Math.abs(drawn - e.style.fontSize) > 0.05)
                faults.push(`${theme.id} ${stage} ${n} ${zone} ${e.name}`);
            }
          }
      }
    expect(faults.slice(0, 10)).toEqual([]);
  });

  test("past the hard maximum the field is named in over; words are never cut", () => {
    const long = "word ".repeat(80).trim();
    const sides = examples(3).map((s, i) => (i === 1 ? { ...s, text: long } : s));
    const r = layoutTemplate(set(sides), THEMES[0] as never, "ks2");
    expect(r.over).toContain("sides[1].text");
    const all = texts(r.slide.elements)
      .map((e) => JSON.stringify(e.doc))
      .join("");
    expect(all.split("word").length - 1).toBe(80);
  });

  test("the committed table is the renderer's measurement on the cards", () => {
    for (const group of Object.keys(SPLIT_GROUPS) as SplitGroup[])
      for (const n of [2, 3] as const)
        for (const zone of ZONES)
          expect(measureSplitCell(group, n, zone, "side-by-side"), `${group} ${n} ${zone}`).toEqual(
            (SET_CAPACITY as Record<string, Record<string, Record<string, unknown>>>)[group]?.[n]?.[
              zone
            ] as never,
          );
  }, 120_000);
});

describe("side by side while a draft streams", () => {
  // The writer streams each example's title, then words, then picture. Every prefix lays without
  // throwing, a picture once shown never vanishes, and the last draft is the closed slide.
  test("example by example, field by field: no picture vanishes, the last draft is the slide", () => {
    for (const stage of STAGES)
      for (const n of [2, 3]) {
        const full = examples(n);
        const steps: SplitSide[][] = [];
        for (let i = 0; i < n; i++) {
          const done = full.slice(0, i);
          const s = full[i] as SplitSide;
          steps.push([...done, { title: s.title, text: "" }]);
          steps.push([...done, { title: s.title, text: s.text }]);
          steps.push([...done, s]);
        }
        let shown = 0;
        let last: SlideElement[] = [];
        for (const sides of steps) {
          // The draft path holds a side's open slot once any side has a picture.
          const held = holdSides(sides);
          const r = layoutTemplate(set(held), THEMES[0] as never, stage);
          const pics = r.slide.elements.filter((e) => e.name === SPLIT_NAMES.picture).length;
          expect(pics, `${stage} ${n}`).toBeGreaterThanOrEqual(shown);
          shown = pics;
          last = r.slide.elements;
        }
        const closed = layoutTemplate(set(full), THEMES[0] as never, stage).slide.elements;
        const box = (e: SlideElement) => `${e.name} ${e.x},${e.y},${e.w},${e.h}`;
        expect(last.map(box)).toEqual(closed.map(box));
      }
  });
});

/** The draft hold, as lay-draft's `keepSidePictures` / `holdRowPictures` apply it. */
function holdSides(sides: SplitSide[]): SplitSide[] {
  const donor = sides.find((s) => s.picture)?.picture;
  if (!donor) return sides;
  return sides.map((s) =>
    s.picture || s.picture === null
      ? s
      : { ...s, picture: { photo: PLACEHOLDER_IMAGE, aspect: 4 / 3, alt: "" } as Figure },
  );
}
