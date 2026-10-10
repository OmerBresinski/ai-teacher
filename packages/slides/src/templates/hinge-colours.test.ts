import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { layoutTemplate, optionColours, type Stage, type TemplateInput } from "./index";

/*
 * UX ruling 203, P8 (TEACH-75 part f): each hinge option's letter disc has its own colour, from
 * the theme's tokens, and the existing reveal (multiple-choice question data, the correct ring in
 * present) is unchanged.
 */
type El = { id: string; name?: string; fill?: string; textStyle?: { color?: string } };
const lum = (h: string) => {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const x = Number.parseInt(h.slice(i, i + 2), 16) / 255;
    return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
};
const ratio = (a: string, b: string) => {
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return ((x ?? 0) + 0.05) / ((y ?? 0) + 0.05);
};
const hinge = (n: number): TemplateInput => ({
  template: "hinge",
  heading: "Quick check",
  stem: "Which part of the blood carries oxygen around the body?",
  options: ["Red blood cells", "White blood cells", "Platelets", "Plasma"].slice(0, n),
  correct: 1,
  explanation: "Red cells carry oxygen.",
});

describe("hinge option colours", () => {
  test("2, 3 and 4 options fit on every theme, each disc its own colour, letters readable", () => {
    for (const stage of ["ks1", "ks2", "ks3"] as Stage[])
      for (const theme of THEMES)
        for (const n of [2, 3, 4]) {
          const r = layoutTemplate(hinge(n), theme, stage);
          expect({ stage, theme: theme.id, n, over: r.over }).toEqual({
            stage,
            theme: theme.id,
            n,
            over: [],
          });
          const discs = (r.slide.elements as El[]).filter((e) => e.name === "Marker");
          expect(discs.map((d) => d.fill)).toEqual(optionColours(theme).slice(0, n));
          expect(new Set(discs.map((d) => d.fill)).size).toBe(n);
          for (const d of discs) {
            const at = { theme: theme.id, fill: d.fill };
            expect({
              ...at,
              letter: ratio(String(d.fill), String(d.textStyle?.color)) >= 4.5,
            }).toMatchObject({ letter: true });
            expect({ ...at, edge: ratio(String(d.fill), theme.colors.surface) >= 3 }).toMatchObject(
              { edge: true },
            );
          }
        }
  });

  test("the reveal is the existing question data: the right option card is marked correct", () => {
    const r = layoutTemplate(hinge(4), THEMES[0] as (typeof THEMES)[number], "ks2");
    const cards = (r.slide.elements as El[]).filter((e) => e.name === "Option");
    expect(r.slide.question?.type).toBe("multiple-choice");
    const q = r.slide.question as { options: { id: string; correct: boolean }[] };
    expect(q.options.map((o) => o.correct)).toEqual([true, false, false, false]);
    expect(q.options.map((o) => o.id)).toEqual(cards.map((c) => c.id));
  });
});
