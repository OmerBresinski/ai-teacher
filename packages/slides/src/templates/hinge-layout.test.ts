import { describe, expect, test } from "bun:test";
import { resolveFontSize } from "../text-style";
import { atKeyStage, getTheme, THEMES, typeScale } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

/*
 * TEACH-75 part D (UX ruling on the multiple-choice pass): options arrange by length. Short ones sit
 * side by side as answer tiles, three sentences stack as full-width rows, four longer ones take a
 * 2x2; every card in a set is the same height and nothing runs past the slide's band.
 */
type El = { name?: string; type: string; x: number; y: number; w: number; h: number };
const STAGES: Stage[] = ["ks1", "ks2", "ks3"];
const hinge = (options: string[], stem = "Which one is right?"): TemplateInput =>
  ({ template: "hinge", heading: "Quick check", stem, options, correct: 1 }) as TemplateInput;
const cards = (els: El[]) => els.filter((e) => e.name === "Option");
const across = (els: El[]) => new Set(cards(els).map((c) => c.y)).size;

const SHORT4 = ["10", "24", "64", "18"];
const SENT3 = [
  "It always carries oxygen-rich blood.",
  "It carries blood away from the heart.",
  "It carries blood towards the heart.",
];
const LONG4 = [
  "Its particles move quickly in every direction.",
  "Its particles are held tightly in fixed places.",
  "Its particles get bigger when they are heated.",
  "Its particles are pulled towards the container walls.",
];

describe("hinge options arrange by length", () => {
  for (const theme of THEMES)
    for (const stage of STAGES) {
      test(`${theme.id} ${stage}: short answers are one row of tiles`, () => {
        const els = layoutTemplate(hinge(SHORT4), theme, stage).slide.elements as El[];
        expect(cards(els)).toHaveLength(4);
        expect(across(els)).toBe(1);
      });
      test(`${theme.id} ${stage}: three sentences stack, one per row`, () => {
        const r = layoutTemplate(hinge(SENT3), theme, stage);
        const els = r.slide.elements as El[];
        if (stage !== "ks1") expect(new Set(cards(els).map((c) => c.x)).size).toBe(1);
        expect(r.over).toEqual([]);
      });
      test(`${theme.id} ${stage}: even card heights, nothing over, the answer stays on its card`, () => {
        for (const opts of [SHORT4, SENT3, LONG4, SENT3.slice(0, 2)]) {
          const r = layoutTemplate(hinge(opts), theme, stage);
          const cs = cards(r.slide.elements as El[]);
          expect(new Set(cs.map((c) => c.h)).size).toBe(1);
          for (const c of cs) expect(c.y + c.h).toBeLessThanOrEqual(512);
          // The reveal marks a card the template made, so the slide never shifts on reveal.
          const q = r.slide.question as {
            type: string;
            options: { id: string; correct: boolean }[];
          };
          expect(q.type).toBe("multiple-choice");
          expect(q.options.map((o) => o.id)).toEqual(
            cs.map((c) => (c as unknown as { id: string }).id),
          );
          expect(q.options.filter((o) => o.correct)).toHaveLength(1);
        }
      });
    }
  test("four longer options at KS3 take a 2x2", () => {
    const els = layoutTemplate(hinge(LONG4), getTheme("studio"), "ks3").slide.elements as El[];
    expect(across(els)).toBe(2);
    expect(new Set(cards(els).map((c) => c.x)).size).toBe(2);
  });
});

describe("practice: the instruction leads, rows keep one rhythm", () => {
  const input = {
    template: "practice",
    heading: "Your turn",
    questions: ["Name the three states of matter.", "Which state keeps its own shape?"],
    instruction: "Answer in full sentences in your book.",
  } as TemplateInput;
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}`, () => {
        const r = layoutTemplate(input, theme, stage);
        const els = r.slide.elements as El[];
        const ins = els.find((e) => e.name === "Instruction");
        const items = els.filter((e) => e.name === "Item");
        expect(r.over).toEqual([]);
        expect(ins && items[0] && ins.y < items[0].y).toBe(true);
        // A short set opens up: the gap between rows is more than the tight stack's.
        const step = (items[1]?.y ?? 0) - (items[0]?.y ?? 0);
        expect(step).toBeGreaterThan((items[0]?.h ?? 0) * 1.6);
      });
});

describe("sized to the room (back-of-room test)", () => {
  type T = El & { style?: { fontSize?: number; preset?: string } };
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: two short options step up to the heading step, on the scale`, () => {
        const r = layoutTemplate(hinge(["A dolphin", "A shark"]), theme, stage);
        const step = typeScale(atKeyStage(theme, stage))?.heading ?? 0;
        const words = (r.slide.elements as T[]).filter((e) => e.name === "Option text");
        for (const e of words) {
          expect(e.style?.fontSize).toBe(step);
          expect(resolveFontSize(atKeyStage(theme, stage), "heading", step)).toBe(step);
        }
        expect(r.over).toEqual([]);
      });
});

describe("bodyLarge: the step between body and heading", () => {
  for (const theme of THEMES)
    for (const stage of STAGES)
      test(`${theme.id} ${stage}: body < bodyLarge < heading, and a heading-role override lands on it`, () => {
        const t = atKeyStage(theme, stage);
        const sc = typeScale(t);
        if (!sc) throw new Error("no scale");
        expect(sc.bodyLarge).toBeGreaterThan(sc.body);
        expect(sc.bodyLarge).toBeLessThan(sc.heading);
        expect(resolveFontSize(t, "heading", sc.bodyLarge)).toBe(sc.bodyLarge);
      });
  test("heart R3 s6 at KS2 grows its options to bodyLarge, inside the band", () => {
    const theme = getTheme("treehouse");
    const r = layoutTemplate(
      hinge(SENT3, "Why is the vessel taking blood from the heart to the lungs an artery?"),
      theme,
      "ks2",
    );
    const sc = typeScale(atKeyStage(theme, "ks2"));
    const words = (r.slide.elements as (El & { style?: { fontSize?: number } })[]).filter(
      (e) => e.name === "Option text",
    );
    for (const e of words) expect(e.style?.fontSize).toBe(sc?.bodyLarge);
    expect(r.over).toEqual([]);
  });
});
