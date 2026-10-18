import { describe, expect, test } from "bun:test";
import type { Theme } from "@tj/domain/documents";
import { contrastRatio } from "../look";
import { THEMES } from "../themes";
import {
  dimGround,
  dimInk,
  markLook,
  SURFACE_TOKEN_SETS,
  surfaceStyle,
  surfacesOf,
} from "../themes/surfaces";
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
          // The gold's key: the card's ink, the letter in the card's fill (never the key role's red);
          // a theme whose key family is the accent (Geometric's gold) takes the key role's fill.
          const card = surfaceStyle(theme, "card");
          const accent = surfacesOf(theme).marks.keyFill === "accent";
          const fill = accent ? surfaceStyle(theme, "key").fill : card.ink;
          // The key's family (TEACH-215 part k): an outline ring on the card, a sticky note.
          const look = markLook(theme, "key", 30, fill ?? "#000", card.fill);
          const under = look.fill === "transparent" ? card.fill : look.fill;
          for (const k of keys) {
            expect(k.shape).toBe(look.shape);
            expect(k.fill).toBe(look.fill);
            expect(contrastRatio(k.textStyle?.color as string, under)).toBeGreaterThanOrEqual(
              accent ? 4.5 : 3,
            );
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

/*
 * TEACH-256 part d (rulings 258, 248): after the reveal a wrong card takes the theme's ground (quieter
 * than a card) and its words the dim tone, never an opacity fade, so a pupil still reads them at
 * 4.5:1 or better on every theme. The tones are tested here; the redrawn cards themselves, each
 * card's own fill against each of its words, in `@tj/editor`'s `hinge-dim.test.ts`.
 */
describe("hinge reveal: the wrong options' dim tone", () => {
  test("every token set: the dim tone reads at 4.5:1 or better on the wrong card's ground", () => {
    for (const [id, t] of Object.entries(SURFACE_TOKEN_SETS)) {
      const ratio = contrastRatio(t.dim as string, t.bg as string);
      expect({ id, ok: ratio >= 4.5 }).toEqual({ id, ok: true });
    }
  });

  /*
   * A theme outside the table (a teacher's own, or one added later) gets its dim tone from its own
   * palette, measured on its own ground, not Paper's or Slate's tokens on a ground they never met.
   */
  const custom = (id: string, dark: boolean, colors: Partial<Theme["colors"]>): Theme => {
    const base = THEMES.find((t) => Boolean(t.dark) === dark) as Theme;
    return { ...base, id, dark, colors: { ...base.colors, ...colors } };
  };
  test.each([
    [
      "custom-cream: a faint muted is stepped toward the ink",
      custom("custom-cream", false, { background: "#F3E6CF", muted: "#C9B79A", ink: "#3B2F2F" }),
    ],
    [
      "custom-ink: a dark ground",
      custom("custom-ink", true, { background: "#14213D", muted: "#3C4A66", ink: "#E5E5E5" }),
    ],
    [
      "custom-mid: neither muted nor ink reads",
      custom("custom-mid", false, { background: "#808080", muted: "#8A8A8A", ink: "#999999" }),
    ],
  ])("%s: the dim tone reads at 4.5:1 on that theme's own ground", (_, theme) => {
    expect(theme.id in SURFACE_TOKEN_SETS).toBe(false);
    expect(dimGround(theme)).toBe(theme.colors.background);
    expect(contrastRatio(dimInk(theme), dimGround(theme))).toBeGreaterThanOrEqual(4.5);
  });

  test("a theme in the table keeps its own tested tokens", () => {
    for (const theme of THEMES) {
      const t = SURFACE_TOKEN_SETS[theme.id];
      if (!t) continue;
      expect([dimInk(theme), dimGround(theme)]).toEqual([t.dim as string, t.bg as string]);
    }
  });
});
