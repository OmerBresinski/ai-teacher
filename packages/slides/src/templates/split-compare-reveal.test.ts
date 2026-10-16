import { describe, expect, test } from "bun:test";
import type { SlideElement } from "@tj/domain/documents";
import { THEMES } from "../themes";
import { type Figure, layoutTemplate, type Stage, type TemplateInput } from "./index";
import { SPLIT_NAMES, type SplitSide, splitGroupOf, splitTable } from "./split-compare";

/*
 * Split compare's reveal (TEACH-75 part w, row 3): the first template that writes `revealStep`
 * itself. A side marked `reveal` shows a "?" medal centred in the box its content will fill; on
 * step 1 an opaque cover in the field's colour and the content appear above the medal. The domain
 * can only make an element appear, never disappear, so the cover is what hides the "?" in the
 * editor, in Present and on the PowerPoint build slide alike. The PPTX build-slide count is in
 * `packages/editor/src/export/split-compare-pptx.test.ts`.
 */
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const photo = (name: string): Figure => ({
  photo: `https://x.test/${name}.jpg`,
  aspect: 4 / 3,
  alt: name,
  subjects: [{ name, x: 0.3, y: 0.2, w: 0.4, h: 0.6 }],
});
const SIDES: Record<"picture" | "quote" | "text", SplitSide[]> = {
  picture: [
    { title: "Shield", text: "Runny lava travels far.", picture: photo("shield") },
    { title: "Composite", text: "Sticky lava piles up.", picture: photo("composite") },
    { title: "Cinder", text: "Ash falls round the vent.", picture: photo("cinder") },
  ],
  quote: [
    { title: "Factory owner", text: "Profits rose.", quote: "More cloth!" },
    { title: "Child worker", text: "Long hours.", quote: "Till dark." },
    { title: "Reformer", text: "New laws.", quote: "Change it!" },
  ],
  text: [
    { title: "Shield", text: "Runny lava travels far and builds broad, gentle slopes." },
    { title: "Composite", text: "Sticky lava piles up into a steep cone." },
    { title: "Cinder", text: "Ash and cinders fall round one vent." },
  ],
};

const steps = (els: SlideElement[]) => Math.max(0, ...els.map((e) => e.revealStep ?? 0));
const centre = (e: { x: number; y: number; w: number; h: number }) => ({
  x: e.x + e.w / 2,
  y: e.y + e.h / 2,
});
const inside = (a: SlideElement, b: SlideElement) =>
  a.x >= b.x - 0.5 &&
  a.y >= b.y - 0.5 &&
  a.x + a.w <= b.x + b.w + 0.5 &&
  a.y + a.h <= b.y + b.h + 0.5;

function laid(zone: keyof typeof SIDES, n: number, hidden: number, stage: Stage = "ks2") {
  const sides = SIDES[zone].slice(0, n).map((s, i) => (i === hidden ? { ...s, reveal: true } : s));
  const input: TemplateInput = {
    template: "split-compare",
    heading: "Three ways to see it",
    sides,
  };
  return layoutTemplate(input, THEMES[0] as never, stage);
}

describe("split-compare reveal (row 3)", () => {
  for (const zone of ["picture", "quote", "text"] as const)
    for (const n of [2, 3])
      for (const stage of STAGES)
        test(`${zone}, ${n} sides, side 2 hidden, ${stage}`, () => {
          const r = laid(zone, n, 1, stage);
          const els = r.slide.elements;
          // KS1's three quoted sides hold a quote of a word beside their words (TEACH-68 part b):
          // the writer never offers them (layout-menu's quote budget), so these quotes are over.
          // The writer never offers KS1's three quoted sides: quoteBudget is below MIN_QUOTE.
          const none =
            zone === "quote" && n === 3 && splitGroupOf(stage) === "KS1"
              ? ["quote"]
              : Object.entries(splitTable(splitGroupOf(stage), n as 2 | 3, zone))
                  .filter(([, l]) => !l.hardMax)
                  .map(([f]) => f);
          expect(r.over.filter((o) => !none.some((f) => o.endsWith(`.${f}`)))).toEqual([]);
          expect(steps(els)).toBe(1);

          const medal = els.find((e) => e.name === SPLIT_NAMES.medal) as SlideElement;
          expect(medal).toBeDefined();
          expect(medal.revealStep ?? 0).toBe(0);
          expect(els.filter((e) => e.name === SPLIT_NAMES.medal)).toHaveLength(1);

          // The medal is centred in the box the side's content fills (its picture, bubble or words).
          const box = els.find(
            (e) => e.name === SPLIT_NAMES.zoneOf[zone] && e.revealStep === 1,
          ) as SlideElement;
          expect(box).toBeDefined();
          const [a, b] = [centre(medal), centre(box)];
          expect(Math.abs(a.x - b.x)).toBeLessThanOrEqual(1);
          expect(Math.abs(a.y - b.y)).toBeLessThanOrEqual(1);

          // On step 1 an opaque cover in the field's colour, painted after the medal, hides it.
          const cover = els.find((e) => e.name === SPLIT_NAMES.cover) as SlideElement & {
            fill: string;
          };
          expect(cover.revealStep).toBe(1);
          expect(cover.opacity ?? 1).toBe(1);
          expect(els.indexOf(cover)).toBeGreaterThan(els.indexOf(medal));
          for (const ring of els.filter((e) => e.name === SPLIT_NAMES.medalRing || e === medal))
            expect(inside(ring, cover)).toBe(true);
          const field = els.filter((e) => e.name === SPLIT_NAMES.field)[1] as { fill: string };
          expect(cover.fill).toBe(field.fill);

          // Everything of side 2 but its title waits for step 1; the other sides show from the start.
          const side2 = els.filter(
            (e) =>
              e.x >= (field as unknown as SlideElement).x &&
              e.x < (field as unknown as SlideElement).x + (field as unknown as SlideElement).w,
          );
          const shownAt0 = side2.filter((e) => (e.revealStep ?? 0) === 0).map((e) => e.name);
          expect(shownAt0).not.toContain(SPLIT_NAMES.text);
          expect(shownAt0).not.toContain(SPLIT_NAMES.quote);
          expect(shownAt0).not.toContain(SPLIT_NAMES.picture);
          expect(shownAt0).toContain(SPLIT_NAMES.title);
          // The content paints above the cover.
          for (const e of side2.filter((x) => x.revealStep === 1 && x !== cover))
            expect(els.indexOf(e)).toBeGreaterThan(els.indexOf(cover));
          const others = els.filter(
            (e) => e.revealStep === 1 && !inside(e, field as unknown as SlideElement),
          );
          expect(others).toEqual([]);
        });

  test("no side marked: no reveal steps, no medal", () => {
    const r = layoutTemplate(
      { template: "split-compare", heading: "Two volcanoes", sides: SIDES.text.slice(0, 2) },
      THEMES[0] as never,
      "ks2",
    );
    expect(steps(r.slide.elements)).toBe(0);
    expect(r.slide.elements.some((e) => e.name === SPLIT_NAMES.medal)).toBe(false);
  });

  test("two sides marked: both appear together on the one step", () => {
    const sides = SIDES.quote.map((s, i) => (i > 0 ? { ...s, reveal: true } : s));
    const r = layoutTemplate(
      { template: "split-compare", heading: "Three views", sides },
      THEMES[0] as never,
      "ks2",
    );
    expect(steps(r.slide.elements)).toBe(1);
    expect(r.slide.elements.filter((e) => e.name === SPLIT_NAMES.medal)).toHaveLength(2);
    expect(r.slide.elements.filter((e) => e.name === SPLIT_NAMES.cover)).toHaveLength(2);
  });
});
