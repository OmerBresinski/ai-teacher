/**
 * The worked example's caps (TEACH-17 part b), measured by the renderer: the most rows (lines and
 * the check) a slide holds with nothing over on every theme: its equations on the heading ladder's
 * upper two steps (`eqFloorOf`), its moves in two lines. The panel's cap is
 * the bar model's build count (4), the title and move word caps are the NOTES caps.
 * `worked.test.ts` holds `worked-capacity.json` equal to `measureWorkedCapacity()`.
 */
import { THEMES } from "../themes";
import { layoutTemplate, type Stage, type TemplateInput } from "./index";
import type { Age } from "./items-row-deps";
import { WORKED_CAPS } from "./worked";

export const WORKED_CAP_STAGE: Record<Age, Stage> = {
  early: "ks1",
  primary: "ks2",
  secondary: "ks3",
};

/** `lines` working lines and a check, the gold's Y8 problem. */
export const workedCapInput = (lines: number): TemplateInput => ({
  template: "worked",
  heading: "Solve 3x + 5 = 20",
  lines: Array.from({ length: lines }, (_, i) => ({
    ...(i ? { move: "Subtract 5 from both sides" } : {}),
    eq: i === lines - 1 ? "x = 5" : "3x + 5 = 20",
    ...(i === lines - 1 ? { answer: true } : {}),
  })),
  check: "3 × *5* + 5 = 20",
});

/** Every theme holds `lines` + check with nothing over (no equation under the floor). */
function holds(age: Age, lines: number): boolean {
  return THEMES.every(
    (theme) =>
      layoutTemplate(workedCapInput(lines), theme, WORKED_CAP_STAGE[age]).over.length === 0,
  );
}

export function measureWorkedCapacity() {
  const out: Record<string, (typeof WORKED_CAPS)[Age]> = {};
  for (const age of ["early", "primary", "secondary"] as Age[]) {
    const cap = WORKED_CAPS[age];
    let lines = 1;
    while (lines < 12 && holds(age, lines + 1)) lines += 1;
    out[age] = { ...cap, base: lines + 1 };
  }
  return out;
}
