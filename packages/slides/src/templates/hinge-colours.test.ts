import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../look";
import { THEMES } from "../themes";
import { layoutTemplate, optionColours, type Stage, type TemplateInput } from "./index";

const on = (...a: Parameters<typeof layoutTemplate>) =>
  layoutTemplate(a[0], a[1], a[2], { ...a[3], optionColours: true });

/*
 * UX ruling 203, P8 (TEACH-75 part f): each hinge option's letter disc has its own colour, from
 * the theme's tokens, and the existing reveal (multiple-choice question data, the correct ring in
 * present) is unchanged.
 */
type El = { id: string; name?: string; fill?: string; textStyle?: { color?: string } };
const ratio = contrastRatio;
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
          const r = on(hinge(n), theme, stage);
          expect({ stage, theme: theme.id, n, over: r.over }).toEqual({
            stage,
            theme: theme.id,
            n,
            over: [],
          });
          const discs = (r.slide.elements as El[]).filter((e) => e.name === "Marker");
          expect(discs.map((d) => d.fill)).toEqual(optionColours(theme).slice(0, n));
          expect(new Set(discs.map((d) => d.fill)).size).toBe(n);
          // Clear of the reveal's correct and incorrect hues, as the token table promises.
          for (const d of discs)
            expect([theme.colors.correct, theme.colors.incorrect]).not.toContain(String(d.fill));
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
    const r = on(hinge(4), THEMES[0] as (typeof THEMES)[number], "ks2");
    const cards = (r.slide.elements as El[]).filter((e) => e.name === "Option");
    expect(r.slide.question?.type).toBe("multiple-choice");
    const q = r.slide.question as { options: { id: string; correct: boolean }[] };
    expect(q.options.map((o) => o.correct)).toEqual([true, false, false, false]);
    expect(q.options.map((o) => o.id)).toEqual(cards.map((c) => c.id));
  });

  test("off by default: discs keep the accent and its onAccent letter", () => {
    for (const theme of THEMES) {
      const r = layoutTemplate(hinge(4), theme, "ks2");
      for (const d of (r.slide.elements as El[]).filter((e) => e.name === "Marker")) {
        expect(d.fill).toBe(theme.colors.accent);
        expect(d.textStyle?.color).toBe(theme.colors.onAccent);
      }
    }
  });
});
