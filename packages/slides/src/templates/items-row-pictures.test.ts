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

  // TEACH-251 part ay (Greg, 27 Oct: "a planned picture is never missing"): the number medal is
  // only the on-screen placeholder while a picture loads; the final state is always a picture.
  test("a pending picture keeps its tile, with its number medal on it while it loads", () => {
    const items = PARTS.map((it, i) => (i === 1 ? { ...it, picture: pic(PLACEHOLDER_IMAGE) } : it));
    const els = layoutTemplate(row(items), THEMES[0] as never, "ks1").slide
      .elements as unknown as (Box & {
      name?: string;
      src?: string;
      alt?: string;
    })[];
    const t = tiles(els);
    expect(t.length).toBe(4);
    expect(t[1]?.src).toBe(PLACEHOLDER_IMAGE);
    expect(t[1]?.alt?.startsWith("Describe this")).toBe(false);
    const marks = els.filter((e) => e.name === ROW_NAMES.medal);
    expect(marks.length).toBeGreaterThan(0);
    for (const m of marks) expect(meets(m, t[1] as Box)).toBe(true);
  });

  test("a picture not in yet (lost, any number of them) keeps its tile slot, never only a number", () => {
    for (const lost of [[2], [1, 3], [0, 1, 2, 3]])
      for (const theme of THEMES) {
        const items = PARTS.map((it, i) => (lost.includes(i) ? { ...it, picture: null } : it));
        const els = layoutTemplate(row(items), theme, "ks1").slide.elements as unknown as (Box & {
          name?: string;
          src?: string;
        })[];
        const where = `${theme.name} ${lost.join(",")}`;
        const t = tiles(els);
        expect(t.length, where).toBe(4);
        for (const k of lost) expect(t[k]?.src, where).toBe(PLACEHOLDER_IMAGE);
        const names = els.filter((e) => e.name === ROW_NAMES.name);
        expect(new Set(names.map((e) => Math.round(e.y))).size, where).toBe(1);
      }
  });

  test("the final state is always a picture: every item placed, no number medal anywhere", () => {
    for (const theme of THEMES)
      for (const stage of STAGES) {
        const loading = PARTS.map((it, i) => (i % 2 ? { ...it, picture: null } : it));
        const before = layoutTemplate(row(loading), theme, stage).slide.elements as {
          name?: string;
        }[];
        expect(before.some((e) => e.name === ROW_NAMES.medal)).toBe(true);
        // Every picture lands (the generation chain never ends empty): the slide is laid out again.
        const after = layoutTemplate(row(PARTS), theme, stage).slide.elements as {
          name?: string;
          src?: string;
        }[];
        const t = tiles(after);
        expect(t.length).toBe(PARTS.length);
        expect(t.every((x) => x.src && x.src !== PLACEHOLDER_IMAGE)).toBe(true);
        expect(after.some((e) => e.name === ROW_NAMES.medal)).toBe(false);
      }
  });
});
