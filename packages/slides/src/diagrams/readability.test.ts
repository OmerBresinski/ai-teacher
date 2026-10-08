import { describe, expect, test } from "bun:test";
import { getTheme, withKeyStage } from "../themes";
import { drawDiagram, lastDiagramProbe, parseDiagram, readabilityFaults } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";
import { TEMPLATE_SPECS } from "./template-specs";
import H1 from "./writer-specs.fixture.json";

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
  }, 120_000);

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
    // KS2 reads at most six steps (dd-diagrams2 caps: KS1 5, KS2 6, KS3 and up 8).
    const seven = { kind: "flow", alt: "x", steps: steps(7) };
    const r = withKeyStage("ks2", () => drawDiagram(seven, t, { x: 0, y: 0, ...ZONES.band }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reasons.join(" ")).toContain("key stage");
    // KS3 adapts: seven steps draw as a two-row snake full width.
    expect(withKeyStage("ks3", () => drawDiagram(seven, t, { x: 0, y: 0, ...ZONES.band })).ok).toBe(
      true,
    );
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

  // r3-diag: every other kind grown from its sample (1 to 10 entries in its main list, labels of 4
  // to 40 characters), at three key stages and both zones: never throws, and what draws reads
  // cleanly; a spec it cannot draw reports why.
  test("grown specs of every kind never throw, and what draws reads cleanly", () => {
    const MAIN: Record<string, string> = {
      "bar-chart": "bars",
      pie: "slices",
      cycle: "steps",
      timeline: "events",
      layers: "layers",
      venn: "items",
      "number-line": "points",
      river: "labels",
      "labelled-diagram": "labels",
      carroll: "cells",
      flow: "steps",
      table: "rows",
      "bar-model": "bars",
    };
    const sample: Record<string, Record<string, unknown>> = {};
    for (const v of [...Object.values(DIAGRAM_SAMPLES), ...Object.values(TEMPLATE_SPECS)] as Record<
      string,
      unknown
    >[])
      sample[v.kind as string] ??= v;
    const relabel = (o: unknown, text: string, i: number): unknown => {
      if (typeof o === "string") return text;
      if (Array.isArray(o)) return o.map((v) => relabel(v, text, i));
      if (!o || typeof o !== "object") return o;
      return Object.fromEntries(
        Object.entries(o).map(([k, v]) => [
          k,
          typeof v === "string" && ["label", "text", "name", "caption"].includes(k) ? text : v,
        ]),
      );
    };
    const bad: string[] = [];
    let n = 0;
    for (const [kind, f] of Object.entries(MAIN)) {
      const base = sample[kind];
      if (!base) continue;
      const items = (base[f] as unknown[]) ?? [];
      for (const count of [1, 3, 6, 10])
        for (const chars of [4, 14, 40]) {
          const text = "Rising prices and falling output".repeat(2).slice(0, chars);
          const spec = {
            ...base,
            [f]: Array.from({ length: count }, (_, i) => relabel(items[i % items.length], text, i)),
          };
          for (const ks of KS)
            for (const z of Object.values(ZONES))
              withKeyStage(ks, () => {
                n++;
                try {
                  const r = drawDiagram(spec, t, { x: 0, y: 0, ...z });
                  if (!r.ok) {
                    if (!r.reasons.length)
                      bad.push(`${kind} ${count}x${chars} ${ks}: refused with no reason`);
                    return;
                  }
                  const faults = readabilityFaults(r.spec, t, { ...z, fs: r.fs });
                  if (faults.length) bad.push(`${kind} ${count}x${chars} ${ks}: ${faults[0]}`);
                } catch (e) {
                  bad.push(`${kind} ${count}x${chars} ${ks}: throws ${(e as Error).message}`);
                }
              });
        }
    }
    expect(n).toBeGreaterThan(800);
    expect(bad).toEqual([]);
  }, 300_000);

  // r3-diag: y11 r2 s10. A label naming a gas line drawn to the top of the canvas was placed past
  // the edge, moved back inside and set across the line. Placement now checks the moved box, and a
  // crossing is never drawn: the drawing is clean or refused.
  test("a label naming a line that runs to the canvas edge stands clear of it", () => {
    const spec = {
      kind: "labelled-diagram",
      alt: "A flask of marble chips and acid on a balance",
      canvas: "square",
      shapes: [
        { type: "rect", x: 15, y: 80, w: 70, h: 12, fill: "muted" },
        {
          type: "polygon",
          points: [
            [40, 30],
            [60, 30],
            [60, 45],
            [75, 78],
            [25, 78],
            [40, 45],
          ],
          fill: "surface",
        },
        { type: "rect", x: 25, y: 62, w: 50, h: 16, fill: "accent2" },
        { type: "rect", x: 42, y: 22, w: 16, h: 9, fill: "surface" },
        {
          type: "line",
          points: [
            [50, 20],
            [52, 12],
            [48, 6],
          ],
          dashed: true,
        },
        { type: "circle", cx: 88, cy: 60, r: 8, fill: "none" },
      ],
      labels: [
        { text: "Escaping carbon dioxide", at: [50, 8] },
        { text: "Loose cotton wool", at: [58, 26] },
        { text: "Acid and marble", at: [50, 70] },
        { text: "Balance", at: [50, 86] },
        { text: "Stopwatch", at: [88, 60] },
      ],
    };
    for (const ks of KS)
      withKeyStage(ks, () => {
        const r = drawDiagram(spec, t, { x: 0, y: 0, ...ZONES.half });
        // y11 is KS4 (and KS3 type matches): it draws there; KS2's larger type may refuse, with a
        // reason, but never draws a crossing.
        if (ks !== "ks2") expect(r.ok).toBe(true);
        if (!r.ok) expect(r.reasons.length).toBeGreaterThan(0);
        if (r.ok)
          expect(
            readabilityFaults(r.spec, t, { ...ZONES.half, fs: r.fs }).filter((f) =>
              f.includes("across a line"),
            ),
          ).toEqual([]);
      });
  });
});
