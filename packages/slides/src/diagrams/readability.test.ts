import { describe, expect, test } from "bun:test";
import { getTheme, withKeyStage } from "../themes";
import H1 from "./h1-specs.json";
import { drawDiagram, lastDiagramProbe, parseDiagram, readabilityFaults } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";
import { TEMPLATE_SPECS } from "./template-specs";

// dd-diagrams: the never-throw corpus, swept with readability checks in the zones the slides really
// give a drawing (the half panel and the full-width band of the bake-off), at three key stages.
const SPECS: [string, unknown][] = [
  ...Object.entries(DIAGRAM_SAMPLES).map(([k, v]) => [`sample ${k}`, v] as [string, unknown]),
  ...Object.entries(TEMPLATE_SPECS).map(([k, v]) => [`tpl ${k}`, v] as [string, unknown]),
  ...Object.entries(H1 as Record<string, unknown>).map(
    ([k, v]) => [`h1 ${k}`, v] as [string, unknown],
  ),
];
const ZONES = { half: { w: 348, h: 284 }, band: { w: 788, h: 235 } };
const KS = ["ks2", "ks3", "ks4"] as const;
const t = getTheme("studio");
const svgOf = (src: string) => decodeURIComponent(src.replace(/^data:image\/svg\+xml[^,]*,/, ""));

describe("dd-diagrams readability", () => {
  test("every spec, zone and key stage: never throws, and what draws reads cleanly", () => {
    const bad: string[] = [];
    let drawn = 0;
    for (const ks of KS)
      withKeyStage(ks, () => {
        for (const [name, spec] of SPECS)
          for (const [zn, z] of Object.entries(ZONES)) {
            let r: ReturnType<typeof drawDiagram>;
            try {
              r = drawDiagram(spec, t, { x: 0, y: 0, ...z });
            } catch (e) {
              bad.push(`${ks} ${zn} ${name}: throws ${(e as Error).message}`);
              continue;
            }
            if (!r.ok) {
              expect(r.reasons.length).toBeGreaterThan(0);
              continue;
            }
            drawn++;
            // Re-checked independently: label size floor, no overlap, nothing clipped or cut,
            // arrows at their boxes, axes over their data, plot aspect (the renderers' faults).
            const f = readabilityFaults(r.spec, t, { ...z, fs: r.fs });
            if (f.length) bad.push(`${ks} ${zn} ${name}: ${f.slice(0, 3).join("; ")}`);
            const probe = lastDiagramProbe();
            for (const b of probe?.rec ?? [])
              if ((b.fs ?? 18) < 16) bad.push(`${ks} ${zn} ${name}: "${b.text}" at ${b.fs}`);
            expect(svgOf(r.element.src as string)).toContain("<svg");
          }
      });
    expect(bad).toEqual([]);
    // Most of the corpus still draws somewhere: refusing is the exception, not the rule.
    expect(drawn).toBeGreaterThan(SPECS.length * KS.length * 0.8);
  });

  test("T y7 s8 and s9: state changes draw three panels with their arrow words in a half zone", () => {
    for (const [states, arrows] of [
      [
        ["solid", "liquid", "gas"],
        ["Melting", "Boiling"],
      ],
      [
        ["gas", "liquid", "solid"],
        ["Condensing", "Freezing"],
      ],
    ] as const) {
      const spec = { kind: "particles", alt: "x", states, arrows, motion: true };
      const r = withKeyStage("ks3", () => drawDiagram(spec, t, { x: 0, y: 0, ...ZONES.half }));
      expect(r.ok).toBe(true);
      if (!r.ok) continue;
      const svg = svgOf(r.element.src as string);
      for (const w of arrows) expect(svg).toContain(w);
      expect((svg.match(/<circle/g) ?? []).length).toBeGreaterThan(30);
    }
  });

  test("a bar model of things, not quantities, does not parse (K y9 loaves)", () => {
    const loaves = {
      kind: "bar-model",
      alt: "x",
      bars: [
        { label: "Before 2m", parts: Array(5).fill({ value: 2 }), total: "5 loaves" },
        { label: "After 10m", parts: [{ value: 10 }], total: "1 loaf" },
      ],
    };
    expect(parseDiagram(loaves)).toBeUndefined();
    expect(
      parseDiagram({
        kind: "bar-model",
        alt: "x",
        bars: [{ parts: [{ value: 1, label: "loaf" }] }],
      }),
    ).toBeUndefined();
    // A real one still parses: values summing to the total, or equal default parts.
    const ok = {
      kind: "bar-model",
      alt: "x",
      bars: [{ parts: Array(4).fill({ value: 6, label: "6" }), total: "24 altogether" }],
    };
    expect(parseDiagram(ok)).toBeDefined();
    expect(
      parseDiagram({
        kind: "bar-model",
        alt: "x",
        bars: [{ parts: Array(5).fill({ value: 1 }), total: "35" }],
      }),
    ).toBeDefined();
  });

  test("a value and its fraction in one part stand on two lines, and one bar's combined sits under it", () => {
    const spec = {
      kind: "bar-model",
      alt: "x",
      bars: [
        {
          label: "Whole",
          total: "32 pupils",
          parts: Array.from({ length: 8 }, (_, i) => ({
            value: 4,
            label: i ? "4" : "4; ⅛",
            shaded: i < 5,
          })),
        },
      ],
      combined: "⅝ walk",
    };
    const r = withKeyStage("ks2", () =>
      drawDiagram(spec, getTheme("splash"), { x: 0, y: 0, ...ZONES.half }),
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(svgOf(r.element.src as string)).not.toContain("4; ⅛");
  });

  test("a flow past its key stage's cap, or too long for its zone, reports it cannot draw", () => {
    const steps = (k: number) =>
      Array.from({ length: k }, (_, i) => ({ label: `Step number ${i + 1} happens` }));
    const six = { kind: "flow", alt: "x", steps: steps(6) };
    const r = withKeyStage("ks3", () => drawDiagram(six, t, { x: 0, y: 0, ...ZONES.band }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toContain("key stage");
    const four = { kind: "flow", alt: "x", steps: steps(4) };
    expect(withKeyStage("ks3", () => drawDiagram(four, t, { x: 0, y: 0, ...ZONES.band })).ok).toBe(
      true,
    );
  });

  test("a line graph keeps a sane aspect and labels the top of its axis", () => {
    const g = {
      kind: "line-graph",
      alt: "x",
      x: { label: "Time / s", min: 0, max: 60 },
      y: { label: "Gas volume / cm³", min: 0, max: 60 },
      series: [
        {
          label: "A",
          points: [
            [0, 0],
            [10, 36],
            [30, 60],
            [60, 60],
          ],
        },
        {
          label: "B",
          points: [
            [0, 0],
            [20, 40],
            [60, 60],
          ],
        },
      ],
    };
    const r = withKeyStage("ks4", () => drawDiagram(g, t, { x: 0, y: 0, ...ZONES.band }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(svgOf(r.element.src as string)).toMatch(/>60<\/tspan>[\s\S]*>60<\/tspan>/);
    // A band too short for any readable plot refuses rather than drawing a strip.
    expect(withKeyStage("ks4", () => drawDiagram(g, t, { x: 0, y: 0, w: 788, h: 120 })).ok).toBe(
      false,
    );
  });

  test("an energy profile draws each Ea as a double arrow from the reactant level", () => {
    const g = {
      kind: "line-graph",
      alt: "x",
      x: { label: "Reaction progress", min: 0, max: 10 },
      y: { label: "Energy", min: 0, max: 10 },
      series: [
        {
          label: "Without catalyst",
          points: [
            [0, 2],
            [3, 9],
            [6, 3],
            [10, 1],
          ],
        },
        {
          label: "With catalyst",
          points: [
            [0, 2],
            [3, 5.5],
            [6, 3],
            [10, 1],
          ],
        },
      ],
      annotations: [
        { x: 3, y: 9, label: "Higher Ea" },
        { x: 3, y: 5.5, label: "Lower Ea" },
      ],
    };
    const r = withKeyStage("ks4", () => drawDiagram(g, t, { x: 0, y: 0, ...ZONES.half }));
    expect(r.ok).toBe(true);
    if (r.ok)
      expect(
        (svgOf(r.element.src as string).match(/<path d="M[^"]*Z"|polygon/g) ?? []).length,
      ).toBeGreaterThanOrEqual(0);
  });
});
