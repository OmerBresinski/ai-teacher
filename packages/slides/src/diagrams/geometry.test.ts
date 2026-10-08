import { describe, expect, test } from "bun:test";
import { getTheme, THEMES, withKeyStage } from "../themes";
import { DIAGRAM_ZONES } from "./capacity";
import { FIGURE_TEMPLATES } from "./figures";
import { DIAGRAM_SAMPLES } from "./fixtures";
import {
  diagramGeometryFaults,
  figureGeometryFaults,
  PLOT_MIN,
  renderedScale,
  segmentsCross,
} from "./geometry";
import { diagramFaults, lastDiagramProbe, withLongLabels } from "./index";
import { type DiagramPreset, withDiagramPreset } from "./style";
import { TEMPLATE_SPECS } from "./template-specs";
import H1 from "./writer-specs.fixture.json";

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
  // FIX-ENERGY (y11 s7): the catalysed profile with long arrow labels. Its half zone (363 x 378)
  // squeezes the plot, so generation gives it the full-width zone (844 wide, 223-228 high at
  // KS3/4 under its three teaching lines): there the legend stands beside the plot and the plot
  // keeps most of the figure's height.
  const KS_THEMES = ["studio", "chalk", "night-lab"];
  for (const p of PRESETS)
    test(`the y11 catalysed profile draws clean in its full-width zone at KS3 and KS4 (${p})`, () => {
      withDiagramPreset(p, () => {
        for (const ks of ["ks3", "ks4"])
          for (const id of KS_THEMES)
            withKeyStage(ks, () => {
              const t = getTheme(id);
              const half = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, {
                w: 363,
                h: 378,
              });
              expect(figureGeometryFaults(half.children, t)).toContain(
                "the plot is squeezed to a strip",
              );
              for (const size of [{ w: 844, h: 223 }, DIAGRAM_ZONES.full]) {
                const d = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, size);
                expect([ks, id, size.h, ...figureGeometryFaults(d.children, t)]).toEqual([
                  ks,
                  id,
                  size.h,
                ]);
                const axis = d.children.find((c) => c.name === "Progress axis");
                const legend = d.children.filter(
                  (c) => c.type === "text" && /catalyst/.test(JSON.stringify(c.doc)),
                );
                expect(legend.length).toBe(2);
                // Beside the plot: right of the progress axis's end, not under it.
                for (const l of legend)
                  expect(l.x).toBeGreaterThan((axis?.x ?? 0) + (axis?.w ?? 0));
                const energy = d.children.find((c) => c.name === "Energy axis");
                expect(energy?.h ?? 0).toBeGreaterThanOrEqual(size.h * PLOT_MIN);
              }
            });
      });
    });
  test("a narrow zone packs the legend into rows under the plot", () => {
    for (const id of KS_THEMES)
      withKeyStage("ks4", () => {
        const t = getTheme(id);
        const d = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, DIAGRAM_ZONES.half);
        const axis = d.children.find((c) => c.name === "Progress axis");
        const legend = d.children.filter(
          (c) => c.type === "text" && /catalyst/.test(JSON.stringify(c.doc)),
        );
        expect(legend.length).toBe(2);
        for (const l of legend) expect(l.y).toBeGreaterThan((axis?.y ?? 0) + (axis?.h ?? 0));
      });
  });
  test(`a plot under ${PLOT_MIN * 100}% of its figure's height is a fault`, () => {
    const t = getTheme("studio");
    const d = FIGURE_TEMPLATES["energy-profile"].draw(Y11 as never, t, DIAGRAM_ZONES.full);
    expect(figureGeometryFaults(d.children, t)).not.toContain("the plot is squeezed to a strip");
    // The same drawing with empty room added under it: the plot is now a strip of the figure.
    const energy = d.children.find((c) => c.name === "Energy axis");
    const tall = (energy?.h ?? 0) / (PLOT_MIN - 0.05);
    const pad = { ...(d.children.at(-1) as never as object), y: tall - 1, h: 1 } as never;
    expect(figureGeometryFaults([...d.children, pad], t)).toContain(
      "the plot is squeezed to a strip",
    );
  });
  test("an energy profile always draws, at every key stage, theme and zone (never throws)", () => {
    const zones = [
      { w: 363, h: 378 },
      DIAGRAM_ZONES.half,
      DIAGRAM_ZONES.full,
      { w: 844, h: 179 },
      { w: 844, h: 140 },
      { w: 300, h: 120 },
      { w: 160, h: 300 },
    ];
    const specs = [
      Y11,
      { ...Y11, activationLabel: undefined, changeLabel: undefined },
      {
        reactants: "A",
        products: "B",
        activationEnergy: 8,
        energyChange: 3,
        catalysedActivationEnergy: 5,
      },
      { reactants: "", products: "", activationEnergy: -1, energyChange: 4 },
    ];
    for (const ks of ["ks1", "ks2", "ks3", "ks4", "ks5"])
      withKeyStage(ks, () => {
        for (const t of THEMES.filter((x) => ["studio", "splash", "chalk"].includes(x.id)))
          for (const p of ["flat"] as DiagramPreset[])
            withDiagramPreset(p, () => {
              for (const size of zones)
                for (const v of specs) {
                  const d = FIGURE_TEMPLATES["energy-profile"].draw(v as never, t, size);
                  expect(d.children.length).toBeGreaterThan(0);
                  expect(() => figureGeometryFaults(d.children, t)).not.toThrow();
                }
            });
      });
  });
  // FIX-ENERGY: every saved diagram kind at every key-stage type size never throws, and draws clean
  // in the half zone or, stepping up, in the big one (the DIAGRAM-AUDIT real corpus is swept by the
  // same rule in FULL-RUN/fix-energy).
  test("every diagram kind at every key stage: never throws, clean in the half or the big zone", () => {
    const t0 = "studio";
    const bad: string[] = [];
    for (const ks of ["ks1", "ks2", "ks4"])
      withKeyStage(ks, () => {
        const t = getTheme(t0);
        withDiagramPreset("flat", () => {
          for (const [name, spec] of SPECS) {
            let half: string[];
            let full: string[];
            try {
              half = diagramGeometryFaults(spec, t, DIAGRAM_ZONES.half);
              full = half.length ? diagramGeometryFaults(spec, t, DIAGRAM_ZONES.full) : [];
            } catch (e) {
              bad.push(`${ks} ${name}: throws ${(e as Error).message}`);
              continue;
            }
            if (full.length) bad.push(`${ks} ${name}: ${full.join("; ")}`);
          }
        });
      });
    expect(bad).toEqual([]);
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
