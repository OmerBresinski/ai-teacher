import { describe, expect, test } from "bun:test";
import { PLACEHOLDER_IMAGE } from "../layouts";
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import { ROW_NAMES } from "./items-row";

/** Items row pictures (TEACH-247 part bg): parts of a whole, each with a small picture tile. */
const pic = (photo = "/p.jpg") => ({ photo, aspect: 1.5, alt: "" });
const PARTS = [
  { name: "Roots", text: "Hold the plant in the soil.", picture: pic() },
  { name: "Stem", text: "Holds the plant up.", picture: pic() },
  { name: "Leaves", text: "Make food from sunlight.", picture: pic() },
  { name: "Flower", text: "Makes seeds.", picture: pic() },
];
const row = (items: TemplateInput["items"]): TemplateInput =>
  ({ template: "items-row", heading: "The parts of a plant", items }) as TemplateInput;
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const tiles = <T extends { name?: string }>(els: T[]) =>
  els.filter((e) => e.name === ROW_NAMES.picture);
type Box = { x: number; y: number; w: number; h: number };
const meets = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("items row pictures", () => {
  test("every theme and KS1-KS3: one unlabelled tile per item, nothing over or overlapping", () => {
    for (const theme of THEMES)
      for (const stage of STAGES)
        for (const n of [2, 3, 4]) {
          const r = layoutTemplate(row(PARTS.slice(0, n)), theme, stage);
          const where = `${theme.name} ${stage} ${n}`;
          expect(r.over, where).toEqual([]);
          const els = r.slide.elements as unknown as (Box & { name?: string; type: string })[];
          const t = tiles(els);
          expect(t.length, where).toBe(n);
          // No medal, icon, number or connector beside a picture.
          expect(
            els.some((e) => e.name === ROW_NAMES.medal || e.name === ROW_NAMES.icon),
            where,
          ).toBe(false);
          const words = els.filter((e) => e.name === ROW_NAMES.name || e.name === ROW_NAMES.text);
          for (const tile of t) {
            expect(tile.y + tile.h, where).toBeLessThanOrEqual(540);
            for (const w of words) expect(meets(tile, w), where).toBe(false);
          }
          for (let i = 1; i < t.length; i++)
            expect(meets(t[i - 1] as Box, t[i] as Box), where).toBe(false);
        }
  });

  test("a pending picture keeps its tile as the placeholder (the editor sweeps each one)", () => {
    const items = PARTS.map((it, i) => (i === 1 ? { ...it, picture: pic(PLACEHOLDER_IMAGE) } : it));
    const t = tiles(
      layoutTemplate(row(items), THEMES[0] as never, "ks1").slide.elements as never,
    ) as {
      src: string;
      alt: string;
    }[];
    expect(t.length).toBe(4);
    expect(t[1]?.src).toBe(PLACEHOLDER_IMAGE);
    expect(t[1]?.alt.startsWith("Describe this")).toBe(false);
  });

  test("one lost picture takes its item's number in the tile's place; the row stays even", () => {
    for (const theme of THEMES) {
      const items = PARTS.map((it, i) => (i === 2 ? { ...it, picture: null } : it));
      const els = layoutTemplate(row(items), theme, "ks1").slide.elements as unknown as (Box & {
        name?: string;
        type: string;
      })[];
      expect(tiles(els).length, theme.name).toBe(3);
      const names = els.filter((e) => e.name === ROW_NAMES.name);
      expect(new Set(names.map((e) => Math.round(e.y))).size, theme.name).toBe(1);
      // The lost item's column holds a medal (its number), never an empty frame.
      const lost = names[2] as Box;
      const col = { x: lost.x, y: 0, w: lost.w, h: lost.y };
      const marks = els.filter((e) => e.name === ROW_NAMES.medal && meets(e, col));
      expect(marks.length, theme.name).toBeGreaterThan(0);
      for (const t of tiles(els)) expect(meets(t, col), theme.name).toBe(false);
    }
  });

  test("two lost pictures: the whole row is numbered", () => {
    const items = PARTS.map((it, i) => (i === 1 || i === 3 ? { ...it, picture: null } : it));
    const els = layoutTemplate(row(items), THEMES[0] as never, "ks1").slide.elements as {
      name?: string;
    }[];
    expect(tiles(els).length).toBe(0);
    expect(els.filter((e) => e.name === ROW_NAMES.medal).length).toBeGreaterThanOrEqual(4);
  });

  test("every picture lost: the row falls back to numbers", () => {
    const items = PARTS.map((it) => ({ ...it, picture: null }));
    const els = layoutTemplate(row(items), THEMES[0] as never, "ks2").slide.elements as {
      name?: string;
    }[];
    expect(tiles(els).length).toBe(0);
    expect(els.some((e) => e.name === ROW_NAMES.medal)).toBe(true);
  });
});
