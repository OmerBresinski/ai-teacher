/**
 * Which text boxes hold maths, by name (NOTATION-PLAN ticket 2): the worked example's equation
 * cells and the equation slide's formula and steps.
 *
 * Kept free of template imports on purpose: the editor's renderer and the ruler (`reflow.ts`,
 * `TextView`) read it, and importing `templates/worked.ts` from there pulled every template (and
 * the theme art) into the editor's module graph through a cycle, which left the art's tokens
 * undefined in the web build. The worked names are the strings `WORKED_NAMES.left` and `.right`
 * hold in `templates/worked.ts` (kept byte for byte as the gold port); `maths-text.test.ts` checks
 * they agree.
 */

/** The equation slide's maths boxes (`templates/index.ts` `equationHero`). */
export const EQUATION_NAMES = { formula: "Formula", step: "Step" } as const;

/** The worked example's equation cells (`WORKED_NAMES.left` / `.right`). */
export const WORKED_MATHS_NAMES = { left: "Eq left", right: "Eq right" } as const;

/**
 * Whether a text box, by its name, holds maths. Its fractions are found with `{ maths: true }`
 * (`fractions.ts`), by the renderer and the ruler alike, so a bare `150/3` or `distance/time` there
 * stacks.
 */
export function mathsElement(name: string | undefined): boolean {
  return (
    name === WORKED_MATHS_NAMES.left ||
    name === WORKED_MATHS_NAMES.right ||
    name === EQUATION_NAMES.formula ||
    name === EQUATION_NAMES.step
  );
}
