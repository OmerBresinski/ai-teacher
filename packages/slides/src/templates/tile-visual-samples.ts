import type { Figure, TemplateInput } from "./index";

/**
 * Tile visuals (TEACH-75 part d): a compare card, a sequence stage and a hinge may carry a diagram.
 * Samples for the fit tests and the before/after renders; the three blood vessels are the key case
 * (LAYOUT-AUDIT finding 4: a comparison of structures lost its drawings to text cards).
 */
const vessel = (name: string, outer: number, inner: number, wall: string): Figure => ({
  diagram: {
    kind: "labelled-diagram",
    alt: `A cross-section of ${name}: ${wall}.`,
    shapes: [
      { type: "circle", cx: 50, cy: 50, r: outer, fill: "accent" },
      { type: "circle", cx: 50, cy: 50, r: inner, fill: "surface" },
    ],
    labels: [],
  },
});

const VESSELS = [
  {
    label: "Artery",
    text: "Thick muscular wall, narrow lumen.",
    f: vessel("an artery", 40, 14, "a thick wall"),
  },
  {
    label: "Vein",
    text: "Thin wall, wide lumen, valves.",
    f: vessel("a vein", 40, 30, "a thin wall"),
  },
  {
    label: "Capillary",
    text: "Wall one cell thick.",
    f: vessel("a capillary", 22, 18, "one cell thick"),
  },
  { label: "Heart", text: "Pumps blood to both.", f: vessel("the aorta", 40, 22, "elastic wall") },
];

/** A drawn stage: the moon lit from the right, `lit` (0..1) of its face showing. */
const moon = (name: string, lit: number): Figure => ({
  diagram: {
    kind: "labelled-diagram",
    alt: `The moon at ${name}.`,
    shapes: [
      { type: "circle", cx: 50, cy: 50, r: 34, fill: "surface" },
      { type: "ellipse", cx: 50 + 34 * (1 - lit), cy: 50, rx: 34 * lit, ry: 34, fill: "accent" },
    ],
    labels: [],
  },
});

/** A compare of `n` (2 to 4) cards, each with a drawn cross-section. */
export function compareWithDiagrams(n: 2 | 3 | 4): TemplateInput {
  return {
    template: "compare",
    heading: "Three kinds of blood vessel",
    columns: VESSELS.slice(0, n).map((v) => ({ label: v.label, text: v.text, figure: v.f })),
  };
}

/** A picture-sequence of `n` (2 to 4) stages, each a drawn diagram. */
export function sequenceWithDiagrams(n: 2 | 3 | 4): TemplateInput {
  const stages = [
    { caption: "New moon", f: moon("new moon", 0.1) },
    { caption: "Crescent", f: moon("a crescent", 0.3) },
    { caption: "Half moon", f: moon("half moon", 0.5) },
    { caption: "Full moon", f: moon("full moon", 1) },
  ];
  return {
    template: "picture-sequence",
    heading: "The phases of the moon",
    sequence: stages.slice(0, n).map((s) => ({ caption: s.caption, figure: s.f })),
  };
}

/** A hinge about a figure (y2: asked about a square the pupils could not see). */
export function hingeWithFigure(options = 4): TemplateInput {
  return {
    template: "hinge",
    heading: "Quick check",
    stem: "Which vessel is drawn here?",
    options: ["An artery", "A vein", "A capillary", "A valve"].slice(0, options),
    correct: 1,
    figure: VESSELS[0]?.f,
  };
}
