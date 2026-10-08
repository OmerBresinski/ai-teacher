import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { drawFigure, FIGURE_TEMPLATES } from "./index";

type FigureTemplateName = keyof typeof FIGURE_TEMPLATES;

/**
 * Objectives-first's figures, frozen: the writer planner's drawer has its own figure templates
 * (`diagrams/figures`), so these must draw byte for byte as they did before it landed. The snapshot
 * was written on master's figures; a change here is a change to production's slides.
 */
const SAMPLES: Record<FigureTemplateName, unknown[]> = {
  "energy-profile": [
    { reactants: "Reactants", products: "Products", activationEnergy: 6, energyChange: -2 },
    { reactants: "A", products: "B", activationEnergy: 5, energyChange: 3 },
    undefined,
  ],
  "right-triangle": [
    {
      base: { length: 3, label: "3 cm" },
      height: { length: 4, label: "4 cm" },
      hypotenuse: { label: "x" },
    },
    undefined,
  ],
  triangle: [
    {
      vertices: { A: "A", B: "B", C: "C" },
      sides: {
        a: { value: 5, label: "5 cm" },
        b: { value: 6, label: "6 cm" },
        c: { value: 7, label: "7 cm" },
      },
    },
    undefined,
  ],
} as Record<FigureTemplateName, unknown[]>;

const RECTS = [
  { x: 0, y: 0, w: 436, h: 356 },
  { x: 0, y: 0, w: 844, h: 370 },
];

/**
 * Element ids are random; everything else is the drawing. Numbers are kept to 1e-6: trigonometry
 * differs in its last bits between macOS and Linux, a millionth of a point no one can see.
 */
const stable = (v: unknown) =>
  JSON.stringify(v, (k, x) =>
    k === "id" ? undefined : typeof x === "number" ? Math.round(x * 1e6) / 1e6 : x,
  );

describe("production figures are unchanged", () => {
  for (const name of Object.keys(FIGURE_TEMPLATES) as FigureTemplateName[]) {
    test(`${name} on every theme`, () => {
      const out = (SAMPLES[name] ?? [undefined]).flatMap((values) =>
        THEMES.flatMap((theme) =>
          RECTS.map((rect) => stable(drawFigure(name, values, theme, rect))),
        ),
      );
      expect(out).toMatchSnapshot();
    });
  }
});
