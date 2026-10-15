import { describe, expect, test } from "bun:test";
import { contrastRatio } from "../look";
import { THEMES } from "../themes";
import { surfaceStyle } from "../themes/surfaces";
import { HINGE_NAMES } from "./hinge";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";

/*
 * TEACH-256 part b (rulings 161, 230): every hinge letter key is the card's ink (the gold's
 * ink key), a rounded square (never the round number badge), its letter readable on it; the reveal
 * stays the multiple-choice question data, counted from 1. Replaces part f's per-option disc
 * colours (P8), which the v13 gold retired.
 */
type El = {
  id: string;
  name?: string;
  fill?: string;
  shape?: string;
  textStyle?: { color?: string };
};
const hinge = (n: number): TemplateInput => ({
  template: "hinge",
  heading: "Quick check",
  stem: "Which part of the blood carries oxygen around the body?",
  options: ["Red blood cells", "White blood cells", "Platelets", "Plasma"].slice(0, n),
  correct: 1,
  explanation: "Red cells carry oxygen.",
});

describe("hinge letter keys", () => {
  test("2, 3 and 4 options fit on every theme; each key is the card's ink, its letter readable", () => {
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
          const keys = (r.slide.elements as El[]).filter((e) => e.name === HINGE_NAMES.key);
          expect(keys).toHaveLength(n);
          // The gold's key: the card's ink, the letter in the card's fill (never the key role's red).
          const card = surfaceStyle(theme, "card");
          const role = { fill: card.ink };
          for (const k of keys) {
            expect(k.shape).toBe("rounded");
            expect(k.fill).toBe(role.fill);
            expect(
              contrastRatio(k.textStyle?.color as string, k.fill as string),
            ).toBeGreaterThanOrEqual(3);
          }
        }
  });

  test("the reveal is the existing question data: the right option card is marked correct", () => {
    const r = layoutTemplate(hinge(4), THEMES[0] as (typeof THEMES)[number], "ks2");
    const cards = (r.slide.elements as El[]).filter((e) => e.name === HINGE_NAMES.card);
    expect(r.slide.question?.type).toBe("multiple-choice");
    const q = r.slide.question as { options: { id: string; correct: boolean }[] };
    expect(q.options.map((o) => o.correct)).toEqual([true, false, false, false]);
    expect(q.options.map((o) => o.id)).toEqual(cards.map((c) => c.id));
  });
});
