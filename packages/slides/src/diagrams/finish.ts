/**
 * Round 8: the per-theme finish of the code-drawn kinds as one token object per finish. Renderers
 * read every styling value from here (never a number inside a renderer), so the north-star design
 * tokens (type scale, palette roles, stroke, spacing, depth) can replace this table later.
 * Colours are palette roles (`Palette` keys) and wash shares, resolved by the renderer's palette.
 */
import type { Ctx } from "./svg";

export type FinishTokens = {
  stroke: {
    outline: number;
    cut: number;
    ring: number;
    counter: number;
    box: number;
    lump: number;
  };
  /** Corner radius as a share of the label size (boxes) or of the shape's height (lump). */
  radius: { box: number; lump: number };
  /** Washes: the share of the accent mixed into the ground. 0 leaves the ground. */
  wash: { ring: number; blank: number; shaded: number; lump: number };
  /** A counter's highlight opacity (0 = none). */
  highlight: number;
  /** A group ring's dash ("" = solid). */
  ringDash: string;
  /** Ring outline role: the accent or the muted ink. */
  ringRole: "accent" | "muted";
};

export const FINISH: Record<"warm" | "refined", FinishTokens> = {
  warm: {
    stroke: { outline: 3.5, cut: 2.5, ring: 3, counter: 2, box: 3, lump: 2.5 },
    radius: { box: 0.8, lump: 0.35 },
    wash: { ring: 0.12, blank: 0.08, shaded: 1, lump: 0.55 },
    highlight: 0.45,
    ringDash: "",
    ringRole: "accent",
  },
  refined: {
    stroke: { outline: 2, cut: 1.5, ring: 2, counter: 1, box: 2, lump: 1.5 },
    radius: { box: 0.35, lump: 0.1 },
    wash: { ring: 0, blank: 0, shaded: 0.85, lump: 0.55 },
    highlight: 0,
    ringDash: "6 4",
    ringRole: "muted",
  },
};

/** The finish tokens a drawing uses (refined when the theme names none). */
export const finishOf = (x: Pick<Ctx, "finish">): FinishTokens => FINISH[x.finish ?? "refined"];
