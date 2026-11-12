/**
 * Maths set as maths (NOTATION-PLAN ticket 2): one home for the text fixes a formula line takes.
 *
 * `mathText` (the worked example's, W-d6: a hyphen used as a minus is U+2212, a number and its
 * unit never part, `M_r` is "Mr") stays defined in `templates/worked.ts`, whose gold port is kept
 * byte for byte; it is re-exported here so other layouts take the same fixes.
 *
 * `formulaText` adds one rule for a display formula: each operator keeps the term after it (a
 * no-break space after `=`, `÷`, `×`, `+`, `−` …), so a narrow line breaks before an operator,
 * never after it: "speed = distance" / "÷ time", never "speed = distance ÷" / "time". A stacked
 * fraction (`fractions.ts`) is one piece already.
 *
 * Known gap: the headless ruler (`text-measure.ts` `isSpace`) counts a no-break space as a break,
 * so it may count a glued formula one line short at a width where the browser must wrap earlier.
 */
import { mathText } from "./templates/worked";

// The names live in `maths-names.ts` (no template imports, so the editor can read them).
export { EQUATION_NAMES, mathsElement } from "./maths-names";
export { mathText };

const NBSP = " ";
const OPERATOR_GAP = / ([=≈×÷+−<>≤≥≠]) /g;

/** A formula or calculation line as it is set: `mathText`, then each operator glued to its right. */
export function formulaText(s: string): string {
  return mathText(s).replace(OPERATOR_GAP, ` $1${NBSP}`);
}
