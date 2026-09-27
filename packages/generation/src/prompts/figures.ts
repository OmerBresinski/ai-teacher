import type { FigureBrief, FigureRef, FigureTemplateName } from "@tj/domain/documents";

/*
 * What the prompts say about each Figure template (ADR 0032, TEACH-89): when Plan should choose it
 * (`plan-skeleton`), and what its values are and where their numbers come from, in words
 * (`generate-slide`'s figure block and, since TEACH-253, `plan-facts`' figure block, with what the
 * figure's unknown is). Keyed by template, so a new template does not compile until all four are
 * written. The values' rules are the template's schema in `@tj/slides`; these
 * sentences only name them for the model.
 */

/** When a diagram slide with this template fits the lesson, for Plan's kind-fit sentence. */
export const FIGURE_FIT: Record<FigureTemplateName, string> = {
  "right-triangle":
    '"right-triangle" — a right-angled triangle for Pythagoras, with two known sides and the third to find',
  "energy-profile":
    '"energy-profile" — a reaction profile (energy level diagram), for exothermic and endothermic reactions or activation energy',
  triangle:
    '"triangle" — any triangle given by its sides and angles, for the sine and cosine rules, ½ab sin C, angle facts, isosceles and equilateral triangles, similar or congruent triangles, and right-angled trigonometry when an angle is given or asked for',
};

/** The template's `values`, in words, for the slide writer. */
export const FIGURE_VALUES: Record<FigureTemplateName, string> = {
  "right-triangle":
    '"values": { "base", "height", "hypotenuse" }, each { "length"?: a number, "label": at most 12 characters }. "base" and "height" are the two sides that meet at the right angle. Give at least two lengths; with all three, base² + height² = hypotenuse². The side to find has a letter label ("x") and no length.',
  "energy-profile":
    '"values": { "reactants", "products": each at most 24 characters, "activationEnergy": a number from the reactants\' energy up to the peak, "energyChange": products minus reactants, negative when exothermic, "activationLabel"?, "changeLabel"?: at most 8 characters, left out for "Ea" and "ΔH", "energyAxis"?, "progressAxis"?: at most 24 characters, left out for "Energy" and "Progress of reaction" }. The peak is above both levels: activationEnergy is above 0 and above energyChange.',
  triangle:
    '"values": { "vertices"?: { "A", "B", "C" }: printed names, at most 3 characters, "sides"?: { "a", "b", "c" }, "angles"?: { "A", "B", "C" }: each { "value"?: a number, "label"?: at most 12 characters }, "rightAngleAt"?: "A", "B" or "C", "equalSides"?: e.g. ["a", "b"], "equalAngles"?: e.g. ["A", "B"], "unknown"?: the one side or angle the question asks for, "obtuse"?: true for the obtuse one of two possible triangles, "pair"?: a similar triangle drawn beside it, { "scale": a number, 1 when congruent, "vertices"?, "sides"?, "angles"?: labels only, "mirror"?: true to reflect it } }. Side a is opposite angle A (a is BC, b is CA, c is AB); angles are in degrees. Give enough to fix one triangle: three sides, two sides and an angle, one side and two angles, or two angles; anything more agrees with them. The unknown has a letter label ("x", "θ"). Labels are Unicode: "40°", "√3", "2π", "A′".',
};

/** Where the figure's numbers come from and what its labels carry, for the slide writer. */
export const FIGURE_NUMBERS: Record<FigureTemplateName, string> = {
  "right-triangle":
    "The labels carry the numbers, with units, from the worked example or question this slide covers.",
  "energy-profile":
    "The two energies are the numbers, without units, from the worked example or question this slide covers; the labels name the substances and carry no numbers.",
  triangle:
    'The sides and angles are the numbers from the worked example or question this slide covers. A label carries a number with its unit ("7 cm", "40°") or a letter; every "value" is the true number, even behind a letter; the unknown may leave its value out.',
};

/**
 * A diagram slide's figure block, in the user turn beside the slide line (like `photoBlock`): the
 * template, its values in words, what the figure is for, and where its numbers come from.
 */
export function figureBlock(brief: FigureBrief): string[] {
  return [
    `This slide draws a "${brief.template}" figure for ${brief.purpose}. Answer { "kind": "diagram", "caption"?, "heading", "body" (≤ 40 words), "figure": { "template": "${brief.template}", ${FIGURE_VALUES[brief.template]} }, "factRefs", "notes"? }`,
    `${FIGURE_NUMBERS[brief.template]} The body may set a task on the figure ("find x"); call it "the diagram", never a picture.`,
  ];
}

/**
 * What the figure's unknown is, for the facts call (TEACH-253): the answer check compares the
 * fact's stated answer with the value the template works out for it, so the unknown must be named.
 */
export const FIGURE_UNKNOWN: Record<FigureTemplateName, string> = {
  "right-triangle":
    "The side the worked example or question finds is the one with a letter label and no length; its answer is checked against the other two.",
  "energy-profile":
    "The figure has no unknown to work out: its energies are the numbers the worked example or question uses.",
  triangle:
    'Always set "unknown" to the side or angle the worked example or question finds; its answer is checked against the triangle the other values make.',
};

/**
 * The facts call's block for one diagram slide (TEACH-253): the key its figure goes under in
 * `figures`, the template's values in words, and where the numbers and the unknown come from.
 */
export function planFigureBlock(position: number, template: FigureTemplateName): string[] {
  return [
    `Figure for the diagram slide at position ${position}: "figures": { "${position}": { "template": "${template}", ${FIGURE_VALUES[template]} } }`,
    `  ${FIGURE_NUMBERS[template]} ${FIGURE_UNKNOWN[template]}`,
  ];
}

/**
 * The values as the slide writer is shown them (TEACH-253): a triangle's unknown loses its value,
 * so the answer is never put in front of the writer beside the figure. The drawing already prints
 * the unknown as its label, or "?".
 */
function shownValues(figure: FigureRef): Record<string, unknown> {
  const { values } = figure;
  if (figure.template !== "triangle" || typeof values.unknown !== "string") return values;
  const group = /^[abc]$/.test(values.unknown) ? "sides" : "angles";
  const measures = values[group];
  if (typeof measures !== "object" || measures === null) return values;
  const asked = (measures as Record<string, unknown>)[values.unknown];
  if (typeof asked !== "object" || asked === null) return values;
  const { value: _answer, ...label } = asked as Record<string, unknown>;
  return { ...values, [group]: { ...measures, [values.unknown]: label } };
}

/**
 * A diagram slide's block when its fact carries the figure (TEACH-253): the slide shows that figure
 * and the writer answers with the text only (`diagramTextSpecSchemaFor`).
 */
export function figureShownBlock(figure: FigureRef): string[] {
  return [
    `This slide shows the "${figure.template}" figure of the worked example or question it covers: ${JSON.stringify(shownValues(figure))}. Write the heading and body about it. Answer { "kind": "diagram", "caption"?, "heading", "body" (≤ 40 words), "factRefs", "notes"? }`,
    'The body may set a task on the figure ("find x") and never gives the answer; call it "the diagram", never a picture.',
  ];
}
