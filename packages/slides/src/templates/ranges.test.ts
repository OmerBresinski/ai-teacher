import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import {
  type AspectRange,
  type Figure,
  layoutTemplate,
  PICTURE_RANGES,
  type Stage,
  type TemplateInput,
} from "./index";

/**
 * TEACH-237: picture slots with an aspect range. At every key stage, for a picture at either end of
 * its range (and past both ends), every word box is exactly where the fit and capacity tables
 * measured it (with a 4:3 picture), and no picture overlaps words or leaves the slide.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3", "ks4", "ks5"];
const theme = getTheme("classic");
/** A placed photo of `aspect`; `undefined` is an open slot, which takes its whole box. */
const photo = (aspect: number | undefined, label: string): Figure =>
  ({ photo: `/p/${label}.png`, ...(aspect ? { aspect } : {}), alt: label }) as Figure;

const cases: {
  name: string;
  range: AspectRange;
  input: (a: number | undefined) => TemplateInput;
}[] = [
  ...([2, 3, 4] as const).map((n) => ({
    name: `picture-sequence of ${n}`,
    range: PICTURE_RANGES["picture-sequence"][n],
    input: (a: number | undefined) =>
      ({
        template: "picture-sequence",
        heading: "How a chick grows",
        sequence: Array.from({ length: n }, (_, k) => ({
          caption: `Stage ${k + 1}: the chick grows`,
          figure: photo(a, `s${k}`),
        })),
      }) as TemplateInput,
  })),
  ...([2, 3] as const).map((n) => ({
    name: `compare of ${n}`,
    range: PICTURE_RANGES.compare,
    input: (a: number | undefined) =>
      ({
        template: "compare",
        heading: "Adults and their young",
        columns: Array.from({ length: n }, (_, k) => ({
          label: ["Cow", "Sheep", "Hen"][k] ?? "Dog",
          text: "The young one is smaller.",
          figure: photo(a, `c${k}`),
        })),
      }) as TemplateInput,
  })),
  ...([2, 4] as const).map((n) => ({
    name: `photo tiles of ${n}`,
    range: PICTURE_RANGES.tiles,
    input: (a: number | undefined) =>
      ({
        template: "picture-text",
        heading: "Which is the young one?",
        lead: "Look at each picture.",
        points: ["Find the adult.", "Find its young."],
        figure: {
          ...photo(a, "t0"),
          tiles: Array.from({ length: n - 1 }, (_, k) => photo(a, `t${k + 1}`)),
        },
      }) as TemplateInput,
  })),
];

type El = { type: string; name?: string; x: number; y: number; w: number; h: number; src?: string };
const els = (input: TemplateInput, stage: Stage) =>
  layoutTemplate(input, theme, stage).slide.elements as unknown as El[];
const words = (e: El[]) =>
  e.filter((x) => x.type === "text").map(({ id: _id, ...rest }: El & { id?: string }) => rest);
const pictures = (e: El[]) => e.filter((x) => x.type === "image" && x.src?.startsWith("/p/"));
const hit = (a: El, b: El) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("picture slot ranges keep the measured word boxes", () => {
  for (const c of cases)
    for (const stage of STAGES) {
      const measured = els(c.input(4 / 3), stage);
      const slots = pictures(els(c.input(undefined), stage));
      const [lo, hi] = c.range;
      test.each([lo, hi, lo * 0.7, hi * 1.3, 1])(`${c.name}, ${stage}, aspect %p`, (a) => {
        const laid = els(c.input(a), stage);
        // The words are exactly where the tables measured them.
        expect(words(laid)).toEqual(words(measured));
        const pics = pictures(laid);
        expect(pics.length).toBe(slots.length);
        for (const [k, p] of pics.entries()) {
          const box = slots[k] as El;
          // Inside the measured box, never over words, never off the slide.
          expect(p.x).toBeGreaterThanOrEqual(box.x - 1);
          expect(p.y).toBeGreaterThanOrEqual(box.y - 1);
          expect(p.x + p.w).toBeLessThanOrEqual(box.x + box.w + 1);
          expect(p.y + p.h).toBeLessThanOrEqual(box.y + box.h + 1);
          for (const w of words(laid)) expect(hit(p, w as El)).toBe(false);
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.y + p.h).toBeLessThanOrEqual(540);
          expect(p.x + p.w).toBeLessThanOrEqual(960);
          // Inside the range the picture keeps its own shape: nothing is cropped.
          const shape = p.w / p.h;
          if (a >= lo && a <= hi) {
            expect(Math.abs(shape - a) / a).toBeLessThan(0.03);
            expect((p as { crop?: unknown }).crop).toBeUndefined();
          }
        }
      });
    }
});
