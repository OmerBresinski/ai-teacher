import { describe, expect, it } from "bun:test";
import type {
  GroupElement,
  LineElement,
  PathElement,
  SlideElement,
  TextElement,
} from "@tj/domain/documents";
import { boxH, FIGURE_RECT } from "../layouts";
import { pathSegments, samplePath } from "../path";
import { isEditorialIssue } from "../specs";
import { getTheme, THEMES } from "../themes";
// Through the index, not `./energy-profile`: that module is in the layouts ↔ figures import cycle
// and cannot be loaded first (see the header of `./right-triangle`).
import { drawFigure, energyProfileValuesSchema, type FigureRect } from ".";

/* TEACH-94 acceptance rows 1 to 6: the energy-profile Figure template. */

const RECT = FIGURE_RECT;
const chalk = getTheme("chalk");

const NAMES = { reactants: "methane and oxygen", products: "carbon dioxide and water" };
const values = (activationEnergy: number, energyChange: number, extra: object = {}) => ({
  ...NAMES,
  activationEnergy,
  energyChange,
  ...extra,
});

type Point = { x: number; y: number };
type Box = { x: number; y: number; w: number; h: number };

const textOf = (el: TextElement) =>
  (el.doc.content ?? []).map((p) => (p.content ?? []).map((n) => n.text ?? "").join("")).join("\n");
const texts = (g: GroupElement) => g.children.filter((c): c is TextElement => c.type === "text");
const lines = (g: GroupElement) => g.children.filter((c): c is LineElement => c.type === "line");
const labelled = (g: GroupElement, text: string) => {
  const found = texts(g).find((t) => textOf(t) === text);
  if (!found) throw new Error(`no label "${text}"`);
  return found;
};
const caption = (g: GroupElement) => texts(g).find((t) => textOf(t) === "Not drawn to scale");
const named = (g: GroupElement, name: string) => {
  const found = lines(g).find((l) => l.name === name);
  if (!found) throw new Error(`no line "${name}"`);
  return found;
};
const curveOf = (g: GroupElement) => {
  const curve = g.children.find((c): c is PathElement => c.type === "path");
  if (!curve) throw new Error("no curve");
  return curve;
};
/** A line's two ends in the group's space. */
const endsOf = (l: LineElement): [Point, Point] => [
  { x: l.x + l.from.x * l.w, y: l.y + l.from.y * l.h },
  { x: l.x + l.to.x * l.w, y: l.y + l.to.y * l.h },
];
/** The curve's levels in the group's space: reactants', peak, products'. */
const levelsOf = (g: GroupElement) => {
  const c = curveOf(g);
  const y = (i: number) => c.y + (c.points[i]?.y ?? 0) * c.h;
  const x = (i: number) => c.x + (c.points[i]?.x ?? 0) * c.w;
  return { reactants: y(0), peak: y(2), products: y(3), peakX: x(2), left: x(0) };
};

describe("drawFigure: energy-profile", () => {
  it("draws an exothermic profile in proportion, the arrows and labels in place (row 1)", () => {
    const given = values(50, -90);
    const g = drawFigure("energy-profile", given, chalk, RECT);
    expect([g.type, g.name, g.x, g.y, g.w, g.h]).toEqual([
      "group",
      "Energy profile",
      RECT.x,
      RECT.y,
      RECT.w,
      RECT.h,
    ]);
    expect(g.figure).toEqual({ template: "energy-profile", values: given });
    expect(g.alt).toBe(
      "Energy profile of an exothermic reaction from methane and oxygen to carbon dioxide and water. Activation energy 50, energy change −90.",
    );
    expect(caption(g)).toBeUndefined();

    const labelH = boxH(chalk, "small");
    const { reactants, peak, products, peakX, left } = levelsOf(g);
    expect(products).toBeGreaterThan(reactants);
    // In proportion: the reactants' level is 90 of the 140 up from the products' to the peak.
    expect((products - reactants) / (products - peak)).toBeCloseTo(90 / 140, 5);

    const curve = curveOf(g);
    expect(curve.smooth).toBe(true);
    expect(curve.closed).toBeFalsy();
    expect(curve.stroke).toBe(chalk.colors.accent);
    expect(curve.strokeWidth).toBe(4);
    expect(curve.points.map((p) => p.x)).toEqual([0, 0.24, 0.45, 0.66, 1]);
    expect(curve.points[0]?.y).toBe(curve.points[1]?.y);
    expect(curve.points[3]?.y).toBe(curve.points[4]?.y);
    expect(curve.points[2]?.y).toBe(0);

    // The axes: the energy axis at x = 12 up to just under its name, the arrow at the top.
    const [energyFoot, energyTip] = endsOf(named(g, "Energy axis"));
    expect([energyFoot.x, energyTip.x, energyTip.y]).toEqual([12, 12, labelH + 4]);
    expect(named(g, "Energy axis").arrowEnd).toBe(true);
    const [progressFoot, progressTip] = endsOf(named(g, "Progress axis"));
    expect(progressFoot).toEqual(energyFoot);
    expect(progressTip.y).toBe(energyFoot.y);
    expect(progressTip.x).toBeGreaterThan(progressFoot.x);
    expect(energyFoot.y).toBe(RECT.h - labelH - 16);
    expect(named(g, "Progress axis").arrowEnd).toBe(true);
    expect(left).toBe(12 + 16);
    expect(peak).toBe(labelH + 20);

    // The energy axis's name is horizontal, in a row of its own at the top left.
    const energy = labelled(g, "Energy");
    expect([energy.x, energy.y, energy.h, energy.style.align]).toEqual([0, 0, labelH, "left"]);
    const progress = labelled(g, "Progress of reaction");
    expect(progress.y).toBeGreaterThan(energyFoot.y);
    expect(progress.x + progress.w / 2).toBeCloseTo((12 + RECT.w) / 2, 5);

    // The dashed guide at the reactants' level, from the plateau's end to past the ΔH arrow.
    const guide = named(g, "Reactants' level");
    const [guideFrom, guideTo] = endsOf(guide);
    expect([guide.dash, guide.stroke]).toEqual(["dashed", chalk.colors.muted]);
    expect(guideFrom.y).toBeCloseTo(reactants, 5);
    expect(guideTo.y).toBeCloseTo(reactants, 5);
    expect(guideFrom.x).toBeCloseTo(curve.x + 0.24 * curve.w, 5);
    const [changeFrom, changeTo] = endsOf(named(g, "Energy change"));
    expect(guideTo.x).toBeGreaterThan(changeFrom.x);

    // Activation energy: from the reactants' level up to the peak, at the peak's x.
    const ea = named(g, "Activation energy");
    const [eaFrom, eaTo] = endsOf(ea);
    expect(eaFrom.x).toBeCloseTo(peakX, 5);
    expect(eaTo.x).toBeCloseTo(peakX, 5);
    expect(eaFrom.y).toBeCloseTo(reactants, 5);
    expect(eaTo.y).toBeCloseTo(peak, 5);
    expect(ea.arrowEnd).toBe(true);
    // Its label to the left, a quarter of the way up.
    const eaLabel = labelled(g, "Ea");
    expect(eaLabel.x + eaLabel.w).toBeLessThan(peakX);
    expect(eaLabel.y + eaLabel.h / 2).toBeCloseTo(reactants - (reactants - peak) / 4, 5);

    // Energy change: at 0.94 of the width, from the reactants' level down to the products'.
    expect(changeFrom.x).toBeCloseTo(curve.x + 0.94 * curve.w, 5);
    expect(changeFrom.y).toBeCloseTo(reactants, 5);
    expect(changeTo.y).toBeCloseTo(products, 5);
    const dhLabel = labelled(g, "ΔH");
    expect(dhLabel.x + dhLabel.w).toBeLessThan(changeFrom.x);
    expect(dhLabel.y + dhLabel.h / 2).toBeCloseTo((reactants + products) / 2, 5);

    // The names: the reactants' under their plateau, left-aligned; the products' under theirs.
    const [reactantsLabel] = texts(g).filter((t) => textOf(t).startsWith("methane"));
    const [productsLabel] = texts(g).filter((t) => textOf(t).startsWith("carbon"));
    expect(reactantsLabel?.x).toBe(left);
    expect(reactantsLabel?.style.align).toBe("left");
    expect(reactantsLabel?.y).toBeGreaterThan(reactants);
    expect(productsLabel?.y).toBeGreaterThan(products);
    for (const t of texts(g)) expect(t.style.preset).toBe("small");
  });

  it("draws an endothermic profile, the products' name over its plateau (row 2)", () => {
    const g = drawFigure("energy-profile", values(120, 40), chalk, RECT);
    const { reactants, peak, products } = levelsOf(g);
    expect(products).toBeLessThan(reactants);
    expect((reactants - products) / (reactants - peak)).toBeCloseTo(40 / 120, 5);
    expect(caption(g)).toBeUndefined();
    expect(g.alt).toBe(
      "Energy profile of an endothermic reaction from methane and oxygen to carbon dioxide and water. Activation energy 120, energy change 40.",
    );
    const [productsLabel] = texts(g).filter((t) => textOf(t).startsWith("carbon"));
    if (!productsLabel) throw new Error("no products label");
    // Over its plateau, so above the top of the ΔH arrow, and kept to the plateau's side.
    const [, changeTop] = endsOf(named(g, "Energy change"));
    expect(productsLabel.y + productsLabel.h).toBeLessThan(products);
    expect(productsLabel.y + productsLabel.h).toBeLessThan(changeTop.y);
    const curve = curveOf(g);
    expect(productsLabel.x).toBeGreaterThanOrEqual(curve.x + 0.66 * curve.w);
    // A name within the cap is never cut.
    expect(textOf(productsLabel)).toBe(NAMES.products);
  });

  it("clamps levels that nearly meet and a shallow peak, and says so (row 3)", () => {
    const g = drawFigure("energy-profile", values(10, -2), chalk, RECT);
    const { reactants, peak, products } = levelsOf(g);
    const span = Math.max(reactants, products) - peak;
    expect(Math.abs(products - reactants) / span).toBeGreaterThanOrEqual(0.2 - 1e-9);
    expect((Math.min(reactants, products) - peak) / span).toBeGreaterThanOrEqual(0.25 - 1e-9);
    expect(caption(g)?.style.color).toBe(chalk.colors.muted);
    expect(g.alt?.endsWith(" Not drawn to scale.")).toBe(true);
    // The caption's row comes out of the plot.
    const labelH = boxH(chalk, "small");
    expect(endsOf(named(g, "Progress axis"))[0].y).toBe(RECT.h - labelH - 16 - (labelH + 8));
  });

  it("clamps a very exothermic profile's peak to at least 25 % of the span", () => {
    const g = drawFigure("energy-profile", values(20, -200), chalk, RECT);
    const { reactants, peak, products } = levelsOf(g);
    expect((reactants - peak) / (products - peak)).toBeGreaterThanOrEqual(0.25);
    expect(caption(g)).toBeDefined();
  });

  it("draws the exothermic fallback with the labels as given when the peak is not above both levels (row 4)", () => {
    for (const given of [values(5, 20), values(0, -10), values(-5, -10), values(40, 40)]) {
      const g = drawFigure("energy-profile", given, chalk, RECT);
      const { reactants, products } = levelsOf(g);
      expect(products).toBeGreaterThan(reactants);
      expect(caption(g)).toBeDefined();
      expect(texts(g).some((t) => textOf(t).startsWith("methane"))).toBe(true);
      expect(g.alt?.endsWith(" Not drawn to scale.")).toBe(true);
      expect(g.figure?.values).toEqual(given);
    }
    const issues = energyProfileValuesSchema.safeParse(values(5, 20)).error?.issues ?? [];
    expect(issues).toHaveLength(1);
    expect(isEditorialIssue(issues[0] ?? {})).toBe(true);
    expect(issues[0]?.path).toEqual(["activationEnergy"]);
  });

  it("draws the fallback with empty names and the default labels for values of the wrong shape", () => {
    for (const given of [{}, null, "exothermic", [50, -90], { reactants: "a", products: "b" }]) {
      const g = drawFigure("energy-profile", given, chalk, RECT);
      expect(texts(g).map(textOf)).toEqual([
        "Energy",
        "Progress of reaction",
        "",
        "",
        "Ea",
        "ΔH",
        "Not drawn to scale",
      ]);
      expect(g.alt).toBe("Energy profile. Not drawn to scale.");
    }
  });

  it("uses the labels given for the arrows and the axes", () => {
    const g = drawFigure(
      "energy-profile",
      values(50, -90, {
        activationLabel: "Eₐ",
        changeLabel: "ΔH (kJ)",
        energyAxis: "Energy (kJ/mol)",
        progressAxis: "Reaction pathway",
      }),
      chalk,
      RECT,
    );
    for (const text of ["Eₐ", "ΔH (kJ)", "Energy (kJ/mol)", "Reaction pathway"])
      expect(labelled(g, text)).toBeDefined();
  });

  it("writes a decimal and a zero energy change as given", () => {
    const g = drawFigure("energy-profile", values(2.5, -0.5), chalk, RECT);
    expect(g.alt).toContain("Activation energy 2.5, energy change −0.5.");
    const flat = drawFigure("energy-profile", values(30, 0), chalk, RECT);
    expect(flat.alt).toContain("an exothermic reaction");
    expect(levelsOf(flat).products).toBeGreaterThan(levelsOf(flat).reactants);
  });

  it("is deterministic: the same values and theme give the same elements, ids aside", () => {
    const strip = (g: GroupElement) =>
      JSON.parse(JSON.stringify(g).replace(/"id":"[^"]+"/g, '"id":"_"'));
    const draw = () => drawFigure("energy-profile", values(50, -90), chalk, RECT);
    expect(strip(draw())).toEqual(strip(draw()));
  });
});

describe("energyProfileValuesSchema", () => {
  const issuesOf = (given: unknown) => {
    const result = energyProfileValuesSchema.safeParse(given);
    return result.success ? [] : result.error.issues;
  };

  it("passes an exothermic and an endothermic profile", () => {
    expect(issuesOf(values(50, -90))).toEqual([]);
    expect(issuesOf(values(120, 40))).toEqual([]);
    expect(issuesOf(values(50, -90, { activationLabel: "Ea", changeLabel: "ΔH" }))).toEqual([]);
  });

  it("makes every value rule editorial", () => {
    const cases = [
      values(5, 20), // peak below the products
      values(40, 40), // peak level with the products
      values(0, -10), // no activation energy
      values(50, -90, { reactants: "magnesium and hydrochloric acid" }), // 31 characters
      values(50, -90, { products: "magnesium chloride and hydrogen" }),
      values(50, -90, { activationLabel: "activation" }), // 10 characters
      values(50, -90, { changeLabel: "energy change" }),
      values(50, -90, { energyAxis: "Energy stored in the chemicals" }),
      values(50, -90, { progressAxis: "How far the reaction has gone" }),
    ];
    for (const given of cases) {
      const issues = issuesOf(given);
      expect(issues.length, JSON.stringify(given)).toBe(1);
      for (const issue of issues) expect(isEditorialIssue(issue), issue.message).toBe(true);
    }
    // Exactly at each cap is fine.
    expect(
      issuesOf(
        values(50, -90, {
          reactants: "a".repeat(24),
          products: "b".repeat(24),
          activationLabel: "c".repeat(8),
          changeLabel: "d".repeat(8),
          energyAxis: "e".repeat(24),
          progressAxis: "f".repeat(24),
        }),
      ),
    ).toEqual([]);
  });

  it("leaves a missing field or a wrong type to the shape rules", () => {
    for (const given of [{}, { ...values(50, -90), activationEnergy: "50" }, { reactants: "a" }]) {
      const issues = issuesOf(given);
      expect(issues.length).toBeGreaterThan(0);
      for (const issue of issues) expect(isEditorialIssue(issue)).toBe(false);
    }
  });
});

/* ---- Row 5: the curve is monotone --------------------------------------------------------- */

const GRID = [
  { name: "exothermic (row 1)", v: values(50, -90) },
  { name: "endothermic (row 2)", v: values(120, 40) },
  { name: "clamped (row 3)", v: values(10, -2) },
  { name: "fallback (row 4)", v: values(5, 20) },
  { name: "Ea 20, ΔH −200", v: values(20, -200) },
  { name: "Ea 20, ΔH +200 (fallback)", v: values(20, 200) },
  { name: "Ea 300, ΔH −200", v: values(300, -200) },
  { name: "Ea 300, ΔH +200", v: values(300, 200) },
  {
    name: "short names",
    v: { reactants: "A + B", products: "C", activationEnergy: 50, energyChange: -90 },
  },
  {
    name: "every label at its cap",
    v: values(50, -90, {
      reactants: "sodium hydroxide and HCl",
      products: "sodium chloride + water!",
      activationLabel: "Ea in kJ",
      changeLabel: "ΔH in kJ",
      energyAxis: "Energy in kJ per mole !!",
      progressAxis: "Progress of the reaction",
    }),
  },
  {
    name: "every label at its cap, endothermic",
    v: values(120, 40, {
      reactants: "calcium carbonate, CaCO3",
      products: "calcium oxide + CO2 gas.",
      activationLabel: "Eₐ (kJ)",
      changeLabel: "ΔH (kJ)",
    }),
  },
  { name: "empty names", v: values(50, -90, { reactants: "", products: "" }) },
  // The widest letters at every cap: too tall to fit at full length, so the tallest labels are cut.
  {
    name: "widest letters at every cap",
    v: values(1, -1000, {
      reactants: "M".repeat(24),
      products: "W".repeat(24),
      activationLabel: "M".repeat(8),
      changeLabel: "W".repeat(8),
      energyAxis: "M".repeat(24),
      progressAxis: "W".repeat(24),
    }),
  },
  // Past the caps, as a model answer can be after its retry.
  {
    name: "every label far over its cap",
    v: values(120, 40, {
      reactants: "a mixture of methane and oxygen at room temperature and pressure",
      products: "carbon dioxide gas and water vapour, which condenses on cooling",
      activationLabel: "the activation energy of the reaction",
      changeLabel: "the overall energy change",
      energyAxis: "Energy stored in the chemicals, in kilojoules per mole",
      progressAxis: "How far the reaction has gone from reactants to products",
    }),
  },
];

describe("energy-profile curve (row 5)", () => {
  for (const { name, v } of GRID) {
    it(`no control point above the peak or below the lower plateau: ${name}`, () => {
      const curve = curveOf(drawFigure("energy-profile", v, chalk, RECT));
      for (const s of pathSegments(curve, curve.w, curve.h)) {
        if (s.type !== "cubic") continue;
        for (const y of [s.y1, s.y2]) {
          expect(y).toBeGreaterThanOrEqual(-1e-9);
          expect(y).toBeLessThanOrEqual(curve.h + 1e-9);
        }
      }
    });
  }
});

/* ---- Row 6: every label inside the box and clear of the curve, the arrows and the axes ------ */

/** Points every `step` along a line, both ends included, in the group's space. */
function sampleLine(l: LineElement, step = 4): Point[] {
  const [a, b] = endsOf(l);
  const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / step));
  return Array.from({ length: n + 1 }, (_, k) => ({
    x: a.x + ((b.x - a.x) * k) / n,
    y: a.y + ((b.y - a.y) * k) / n,
  }));
}

/** The curve's samples, moved into the group's space by the path's own x and y. */
const sampleCurve = (curve: PathElement): Point[] =>
  samplePath(pathSegments(curve, curve.w, curve.h), 16).map((p) => ({
    x: curve.x + p.x,
    y: curve.y + p.y,
  }));

const SHRINK = 2;
const insideShrunk = (p: Point, b: Box) =>
  p.x > b.x + SHRINK && p.x < b.x + b.w - SHRINK && p.y > b.y + SHRINK && p.y < b.y + b.h - SHRINK;

const insideRect = (el: SlideElement, rect: FigureRect) =>
  el.x >= 0 && el.y >= 0 && el.x + el.w <= rect.w && el.y + el.h <= rect.h;

const overlaps = (a: Box, b: Box) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("energy-profile placement on every theme (row 6)", () => {
  for (const theme of THEMES) {
    for (const { name, v } of GRID) {
      it(`${name} on ${theme.id}`, () => {
        const g = drawFigure("energy-profile", v, theme, RECT);
        for (const child of g.children)
          expect(
            child.rotation,
            `${child.type} ${child.name ?? ""} is not rotated`,
          ).toBeUndefined();
        const curve = sampleCurve(curveOf(g));
        const drawn = lines(g).map((l) => ({ name: l.name, points: sampleLine(l) }));
        const labels = texts(g);
        for (const label of labels) {
          const text = textOf(label);
          expect(insideRect(label, RECT), `"${text}" inside the box`).toBe(true);
          const onCurve = curve.find((p) => insideShrunk(p, label));
          expect(onCurve, `"${text}" clear of the curve`).toBeUndefined();
          for (const { name: line, points } of drawn) {
            const hit = points.find((p) => insideShrunk(p, label));
            expect(hit, `"${text}" clear of ${line}`).toBeUndefined();
          }
          for (const other of labels)
            if (other !== label)
              expect(overlaps(label, other), `"${text}" / "${textOf(other)}"`).toBe(false);
        }
      });
    }
  }
});

/* ---- Labels past their caps wrap, and are cut past three lines ---------------------------- */

const LONG =
  "a mixture of methane and oxygen at room temperature and pressure, before anything is lit";

describe("energy-profile labels over their caps", () => {
  for (const theme of THEMES) {
    it(`cuts a name past three lines with an ellipsis on ${theme.id}, the alt keeping all of it`, () => {
      const g = drawFigure("energy-profile", values(50, -90, { reactants: LONG }), theme, RECT);
      const [reactants] = texts(g).filter((t) => textOf(t).startsWith("a mixture"));
      if (!reactants) throw new Error("no reactants label");
      const shown = textOf(reactants);
      expect(shown.endsWith("…")).toBe(true);
      expect(LONG.startsWith(shown.slice(0, -1))).toBe(true);
      expect(reactants.h).toBe(boxH(theme, "small", 3));
      expect(g.alt).toContain(`from ${LONG} to`);
      expect(g.figure?.values).toMatchObject({ reactants: LONG });
    });

    it(`cuts the tallest labels a line shorter when they cannot all fit on ${theme.id}`, () => {
      const wide = GRID.find((row) => row.name === "widest letters at every cap")?.v;
      const g = drawFigure("energy-profile", wide, theme, RECT);
      const cut = texts(g).filter((t) => textOf(t).endsWith("…"));
      expect(cut.length).toBeGreaterThan(0);
      for (const label of cut) expect(label.h).toBeLessThan(boxH(theme, "small", 3));
      expect(g.alt).toContain(`from ${"M".repeat(24)} to ${"W".repeat(24)}.`);
    });
  }
});
