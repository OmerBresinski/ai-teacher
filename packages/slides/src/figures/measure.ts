/**
 * The value-and-label measure (ADR 0034 decision 2, TEACH-98): every length, angle and point a
 * geometry Figure draws has a number to draw from and an optional printed label, which may be a
 * letter or an expression ("x", "5x"). The model always supplies the true number, so a template
 * draws in proportion even where the label hides it. Shared by the templates, which never import
 * one another.
 *
 * `editorialIssue` comes from `../editorial`, never `../specs`: `specs.ts` imports `./index`, so
 * reading it from there would put `specs.ts` in the layouts ↔ figures cycle (see `./right-triangle`).
 */
import { z } from "zod";
import { editorialIssue } from "../editorial";
import { unicodeLabel } from "./labels";

export const measureShape = z.object({
  value: z.number().optional(),
  label: z.string().optional(),
});

export type Measure = z.infer<typeof measureShape>;

/** Printed values keep at most this many decimal places, with no trailing zeros. */
const MAX_DECIMALS = 2;

/** A number as a label prints it: 40, 5.5, 3.14, with a true minus sign when negative. */
function printed(n: number): string {
  const rounded = Number(n.toFixed(MAX_DECIMALS));
  // `toFixed` keeps a sign on a value that rounds to zero; the label does not.
  return rounded < 0 ? `−${-rounded}` : `${Math.abs(rounded)}`;
}

/**
 * What a measure prints: its label (through `unicodeLabel`) when it has one; otherwise its value
 * with at most two decimal places and no trailing zeros, followed by `unit` ("°" for an angle);
 * an empty string when it has neither.
 */
export function measureText(m: Measure, unit?: "°"): string {
  if (m.label !== undefined && m.label.trim() !== "") return unicodeLabel(m.label);
  if (m.value === undefined) return "";
  return `${printed(m.value)}${unit ?? ""}`;
}

/**
 * The editorial rules every measure shares, added to `ctx` at `path` (the measure's own path in
 * the template's values; each issue names the field under it): a label longer than `maxLabel`
 * characters, and, with `positive`, a value that is not a positive number. The messages are our
 * own words and numbers only, so no `log` form is needed (ADR 0015).
 */
export function measureRules(
  ctx: z.RefinementCtx,
  path: PropertyKey[],
  m: Measure,
  { maxLabel, positive = false }: { maxLabel: number; positive?: boolean },
): void {
  if ((m.label?.length ?? 0) > maxLabel)
    ctx.addIssue(
      editorialIssue(`Keep each label to ${maxLabel} characters or fewer.`, [...path, "label"]),
    );
  if (positive && m.value !== undefined && !(m.value > 0))
    ctx.addIssue(editorialIssue("Each value is a positive number.", [...path, "value"]));
}
