import { describe, expect, test } from "bun:test";
import { FIGURE_TEMPLATES } from "../figures";
import { getTheme } from "../themes";
import { DIAGRAM_ZONES } from "./capacity";
import {
  diagramGeometryFaults,
  figureGeometryFaults,
  renderedScale,
  segmentsCross,
} from "./geometry";
import H1 from "./h1-specs.json";
import { diagramFaults, lastDiagramProbe, withLongLabels } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";
import { type DiagramPreset, withDiagramPreset } from "./style";
import { TEMPLATE_SPECS } from "./template-specs";

/** Off the writer's menu (DIAGRAM-AUDIT): the cell sample's organelle names crowd its outline. */
const KNOWN = new Set(["sample labelled-cell"]);
const SPECS: [string, unknown][] = [
  ...Object.entries(DIAGRAM_SAMPLES).map(([k, v]) => [`sample ${k}`, v] as [string, unknown]),
  ...Object.entries(TEMPLATE_SPECS).map(([k, v]) => [`tpl ${k}`, v] as [string, unknown]),
  ...Object.entries(H1 as Record<string, unknown>).map(
    ([k, v]) => [`h1 ${k}`, v] as [string, unknown],
  ),
].filter(([k]) => !KNOWN.has(k));
const PRESETS: DiagramPreset[] = ["flat", "line"];
const THEME_IDS = ["studio", "night-lab"];

describe("DIAGRAM-MODERN geometry checks", () => {
  for (const p of PRESETS)
    for (const id of THEME_IDS)
      test(`every diagram draws clean in the half zone or steps up to the full one (${p}, ${id})`, () => {
        const t = getTheme(id);
        const bad: string[] = [];
        withDiagramPreset(p, () => {
          for (const [name, spec] of SPECS) {
            const half = withLongLabels(() => diagramGeometryFaults(spec, t, DIAGRAM_ZONES.half));
            if (!half.length) continue;
            const full = withLongLabels(() => diagramGeometryFaults(spec, t, DIAGRAM_ZONES.full));
            if (full.length) bad.push(`${name}: ${full.join("; ")}`);
          }
        });
        expect(bad).toEqual([]);
      });

  test("the renderers record their arrows and axes for the checks", () => {
    const t = getTheme("studio");
    withDiagramPreset("flat", () => {
      diagramFaults(TEMPLATE_SPECS["cycle-water"], t, DIAGRAM_ZONES.half);
      expect(lastDiagramProbe()?.arrows.length).toBe(4);
      diagramFaults(DIAGRAM_SAMPLES["bar-chart"], t, DIAGRAM_ZONES.half);
      const axis = lastDiagramProbe()?.axes[0];
      expect(axis?.max).toBeGreaterThanOrEqual(axis?.data ?? Infinity);
      diagramFaults(TEMPLATE_SPECS["hydrograph-flashy-values"], t, DIAGRAM_ZONES.full);
      expect(lastDiagramProbe()?.axes.length).toBe(2);
    });
  });

  test("a line graph whose axis stops short of its data never draws", () => {
    const t = getTheme("studio");
    const heating = DIAGRAM_SAMPLES["line-graph-heating"] as { y: Record<string, unknown> };
    const short = { ...heating, y: { ...heating.y, max: 100 } };
    const f = withDiagramPreset("flat", () => diagramGeometryFaults(short, t, DIAGRAM_ZONES.full));
    // The schema refuses it; were it drawn, the axis check would name it.
    expect(f.some((m) => m.includes("axis stops") || m === "it does not draw")).toBe(true);
  });

  for (const p of PRESETS)
    for (const id of THEME_IDS)
      test(`each Ea arrow ends on its own curve's peak; figure labels clear and at the floor (${p}, ${id})`, () => {
        const t = getTheme(id);
        withDiagramPreset(p, () => {
          for (const v of [
            {
              reactants: "Reactants",
              products: "Products",
              activationEnergy: 6,
              energyChange: -2,
              catalysedActivationEnergy: 2,
            },
            {
              reactants: "A",
              products: "B",
              activationEnergy: 8,
              energyChange: 3,
              catalysedActivationEnergy: 5,
            },
            {
              reactants: "methane and oxygen",
              products: "carbon dioxide and water",
              activationEnergy: 200,
              energyChange: -800,
            },
          ])
            for (const size of [{ w: 436, h: 356 }, DIAGRAM_ZONES.full]) {
              const d = FIGURE_TEMPLATES["energy-profile"].draw(v as never, t, size);
              expect(figureGeometryFaults(d.children, t)).toEqual([]);
            }
        });
      });
  // FIX1 (y11 s7, FULL-RUN): a catalysed profile with long arrow labels in a 363 x 378 half zone
  // put its legend on the hump and "Ea" into the legend; the checks above never drew this spec.
  const Y11 = {
    reactants: "Reactants",
    products: "Products",
    activationEnergy: 80,
    energyChange: -30,
    activationLabel: "Ea without catalyst",
    changeLabel: "Energy change",
    energyAxis: "Energy / kJ/mol",
    progressAxis: "Reaction progress",
    catalysedActivationEnergy: 40,
    catalysedLabel: "Ea with catalyst",
  };
  for (const p of PRESETS)
    test(`the y11 catalysed profile: legend off the curves in the half zone, clean full width (${p})`, () => {
      withDiagramPreset(p, () => {
        for (const id of THEME_IDS) {
          const t = getTheme(id);
          for (const size of [
            { w: 363, h: 378 },
            { w: 436, h: 356 },
          ]) {
            const d = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, size);
            // The legend's names stand under the plot when the plot has no clear place for them;
            // the crowded half zone itself is caught (the slide then takes the full-width figure).
            const axis = d.children.find((c) => c.name === "Progress axis");
            const legend = d.children.filter(
              (c) => c.type === "text" && /catalyst/.test(JSON.stringify(c.doc)),
            );
            expect(legend.length).toBe(2);
            if (figureGeometryFaults(d.children, t).length > 0)
              for (const l of legend)
                expect(l.y).toBeGreaterThan((axis?.y ?? 0) + (axis?.h ?? 0) - 8);
          }
          // The half zone squeezes this plot to a strip, so generation moves it to the full width.
          const half = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, { w: 363, h: 378 });
          expect(figureGeometryFaults(half.children, t)).toContain(
            "the plot is squeezed to a strip",
          );
          const full = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, DIAGRAM_ZONES.full);
          expect(figureGeometryFaults(full.children, t)).toEqual([]);
        }
      });
    });
  test("crossing leaders are caught, and a meander section's leaders never cross", () => {
    expect(segmentsCross([0, 0, 10, 10], [0, 10, 10, 0])).toBe(true);
    expect(segmentsCross([0, 0, 10, 0], [0, 5, 10, 5])).toBe(false);
    const t = getTheme("studio");
    for (const p of PRESETS)
      withDiagramPreset(p, () => {
        const f = diagramGeometryFaults(
          TEMPLATE_SPECS["river-meander-section"],
          t,
          DIAGRAM_ZONES.full,
        );
        expect(f).toEqual([]);
      });
  });

  test("labels are measured at the size the slide renders them", () => {
    const t = getTheme("studio");
    expect(renderedScale(TEMPLATE_SPECS["timeline-seven"], t, DIAGRAM_ZONES.full)).toBeCloseTo(
      1,
      5,
    );
  });
});
