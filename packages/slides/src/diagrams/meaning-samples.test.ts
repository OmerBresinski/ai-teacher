import { describe, expect, test } from "bun:test";
import { THEMES } from "../themes";
import { drawDiagram } from "./draw";
import { DIAGRAM_KINDS, DIAGRAM_SAMPLES, fromMeaning, parseDiagram, renderDiagram } from "./index";
import { LIMITS } from "./limits";
import { drawerSchema, FlowMeaningSchema, flowShape, timeOf } from "./meaning";
import { MEANING_SAMPLES } from "./meaning-samples";
import { TEMPLATE_SPECS } from "./template-specs";

const FULL = { x: 0, y: 0, w: 860, h: 380 };
const SIZES = [
  { w: 403, h: 336 },
  { w: 300, h: 420 },
  { w: 860, h: 380 },
];

describe("round 8: never-throw corpus", () => {
  const corpus = { ...DIAGRAM_SAMPLES, ...TEMPLATE_SPECS, ...MEANING_SAMPLES } as Record<
    string,
    unknown
  >;
  test("the corpus covers every kind", () => {
    const kinds = new Set(Object.values(corpus).map((s) => (s as { kind: string }).kind));
    for (const k of DIAGRAM_KINDS) expect([k, kinds.has(k)]).toEqual([k, true]);
  });
  test("every spec, theme and size: drawDiagram answers and never throws", () => {
    for (const [name, spec] of Object.entries(corpus))
      for (const t of THEMES)
        for (const size of SIZES) {
          let r: ReturnType<typeof drawDiagram> | undefined;
          expect(() => {
            r = drawDiagram(spec, t, { x: 0, y: 0, ...size });
          }).not.toThrow();
          expect([name, typeof r?.ok]).toEqual([name, "boolean"]);
        }
  }, 180_000);
  test("every meaning sample draws readably across the slide on every theme", () => {
    const failed: string[] = [];
    for (const [name, spec] of Object.entries(MEANING_SAMPLES))
      for (const t of THEMES) {
        const r = drawDiagram(spec, t, FULL);
        if (!r.ok) failed.push(`${name} on ${t.id}: ${r.reasons.join("; ")}`);
      }
    expect(failed).toEqual([]);
  });
  test("every meaning sample parses as its drawer schema", () => {
    for (const [name, spec] of Object.entries(MEANING_SAMPLES)) {
      const s = drawerSchema((spec as { kind: never }).kind);
      expect([name, s?.safeParse(spec).success]).toEqual([name, true]);
    }
  });
});

const svgOf = (spec: unknown, theme = THEMES[0]) =>
  renderDiagram(spec, theme as (typeof THEMES)[number], { w: 860, h: 380 }) ?? "";

describe("round 8: the wrong picture cannot be represented (DIAGRAM-SOURCE C2.7)", () => {
  test("a quarter of 12 draws 4 rings of 3", () => {
    const svg = svgOf(MEANING_SAMPLES["equal-groups-quarter-of-12"]);
    expect(
      (svg.match(/stroke-dasharray="6 4"|<circle[^>]*r="(\d+(\.\d+)?)"/g) ?? []).length,
    ).toBeGreaterThan(0);
    const counts = (svg.match(/>3</g) ?? []).length;
    expect(counts).toBe(4);
  });
  test("12 in 5 groups does not parse", () => {
    expect(parseDiagram({ kind: "equal-groups", alt: "x", total: 12, groups: 5 })).toBeUndefined();
  });
  test("letters mode shows no state's name", () => {
    const svg = svgOf(MEANING_SAMPLES["particles-identify-letters"]).toLowerCase();
    for (const w of ["solid", "liquid", "gas"])
      expect(svg.replace(/<title>.*<\/title>/, "")).not.toContain(`>${w}<`);
    for (const l of ["A", "B", "C"])
      expect(svgOf(MEANING_SAMPLES["particles-identify-letters"])).toContain(`>${l}<`);
  });
  test("a solid with room does not stand as meaning", () => {
    const bad = {
      kind: "particles",
      alt: "x",
      show: "compare",
      panels: [
        { state: "solid", room: "small" },
        { state: "solid", room: "large" },
      ],
    };
    expect(drawerSchema("particles")?.safeParse(bad).success).toBe(false);
  });
  test("collision headings come from the outcome, in their own panel", () => {
    const c = fromMeaning(MEANING_SAMPLES["particles-collisions"]) as { captions: string[] };
    expect(c.captions).toEqual(["Bounce apart", "Reaction"]);
  });
  test("change words come from the states", () => {
    const c = fromMeaning(MEANING_SAMPLES["particles-change-melting-boiling"]) as {
      arrows: string[];
    };
    expect(c.arrows).toEqual(["melting: energy in", "evaporating: energy in"]);
  });
  test("a flow with a duplicate box does not parse", () => {
    const dup = {
      kind: "flow",
      alt: "x",
      nodes: ["Short-term memory", "short-term memory"],
      links: [{ from: 0, to: 1 }],
    };
    expect(FlowMeaningSchema.safeParse(dup).success).toBe(false);
  });
  test("the multi-store model draws 3 boxes", () => {
    const svg = svgOf(MEANING_SAMPLES["flow-multi-store"]);
    expect((svg.match(/<rect /g) ?? []).length).toBe(3);
  });
  test("flow shapes: chain, cycle, graph", () => {
    const shape = (k: string) => flowShape(FlowMeaningSchema.parse(MEANING_SAMPLES[k])).kind;
    expect(shape("flow-chain")).toBe("chain");
    expect(shape("flow-cycle")).toBe("cycle");
    expect(shape("flow-multi-store")).toBe("graph");
    expect(shape("flow-zero-product")).toBe("graph");
  });
  test("an equation renders as one text line", () => {
    const svg = svgOf(MEANING_SAMPLES["flow-zero-product"]);
    expect(svg).toContain("(x + 3)(x − 4) = 0");
  });
  test("a bar model is built by code from whole, parts and shaded", () => {
    const b = fromMeaning(MEANING_SAMPLES["bar-model-quarter-of-28"]) as {
      bars: { parts: { label: string; shaded?: boolean }[]; total: string }[];
    };
    expect(b.bars[0]?.parts.map((p) => p.label)).toEqual(["7", "7", "7", "7"]);
    expect(b.bars[0]?.parts.filter((p) => p.shaded).length).toBe(3);
    expect(b.bars[0]?.total).toBe("28");
  });
  test("a timeline sorts by date and maps its period by dates", () => {
    const t = fromMeaning(MEANING_SAMPLES["timeline-roman-dates"]) as {
      events: { date: string }[];
      period: { from: number; to: number };
    };
    expect(t.events.map((e) => e.date)).toEqual(["55 BC", "54 BC", "AD 43"]);
    expect(t.period).toMatchObject({ from: 1, to: 2 });
    expect((timeOf("November 1923") as number) > (timeOf("January 1923") as number)).toBe(true);
  });
  test("an old saved spec still draws as it did", () => {
    const old = {
      kind: "flow",
      alt: "x",
      layout: "chain",
      steps: [{ label: "A" }, { label: "B" }],
    };
    expect(fromMeaning(old)).toBe(old);
    expect(parseDiagram(old)).toBeDefined();
  });
  test("the schema reads its limits from the one table", () => {
    const many = Array.from({ length: LIMITS.labels.max + 1 }, (_, i) => ({
      text: `L${i}`,
      at: [10, 10],
    }));
    expect(
      parseDiagram({
        kind: "labelled-diagram",
        alt: "x",
        shapes: [{ type: "circle", cx: 50, cy: 50, r: 20 }],
        labels: many,
      }),
    ).toBeUndefined();
  });
});
