import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { docFromText } from "../factories";
import { SAFE } from "../grid";
import { DIAGRAM_NAME, withDiagramSlot } from "../look";
import { getTheme, THEMES } from "../themes";
import {
  DIAGRAM_DRAWN_NAME,
  DIAGRAM_KINDS,
  DiagramSpecSchema,
  diagramElement,
  parseDiagram,
  renderDiagram,
} from "./index";
import { DIAGRAM_SAMPLES } from "./samples";

const SLOT = { w: 436, h: 356 };
const chalk = getTheme("chalk");

describe("samples", () => {
  test("every kind has a sample, and every sample parses", () => {
    const kinds = new Set(Object.values(DIAGRAM_SAMPLES).map((s) => s.kind));
    expect([...kinds].sort()).toEqual([...DIAGRAM_KINDS].sort());
    for (const [name, spec] of Object.entries(DIAGRAM_SAMPLES)) {
      const r = DiagramSpecSchema.safeParse(spec);
      if (!r.success) throw new Error(`${name}: ${r.error.message}`);
    }
  });

  test.each(Object.keys(DIAGRAM_SAMPLES))("%s matches its snapshot (chalk)", (name) => {
    expect(renderDiagram(DIAGRAM_SAMPLES[name], chalk, SLOT)).toMatchSnapshot();
  });

  test("every sample draws on every theme, deterministically, with no NaN", () => {
    for (const t of THEMES) {
      for (const spec of Object.values(DIAGRAM_SAMPLES)) {
        const a = renderDiagram(spec, t, SLOT);
        expect(a).toStartWith("<svg");
        expect(a).not.toContain("NaN");
        expect(a).not.toContain("undefined");
        expect(renderDiagram(spec, t, SLOT)).toBe(a as string);
      }
    }
  });

  test("the theme's colours and a real family name are used, never a CSS variable", () => {
    const svg = renderDiagram(DIAGRAM_SAMPLES["bar-model-ratio"], chalk, SLOT) ?? "";
    expect(svg).toContain(chalk.colors.ink);
    expect(svg).toContain("Lexend Variable");
    expect(svg).not.toContain("var(");
  });

  test("labels are escaped", () => {
    const svg = renderDiagram(
      { kind: "flow", alt: "a < b & c", steps: [{ label: "<b>x</b>" }, { label: "y & z" }] },
      chalk,
      SLOT,
    );
    expect(svg).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(svg).toContain("y &amp; z");
    expect(svg).not.toContain("<b>");
  });
});

describe("fallback: an invalid spec draws nothing", () => {
  const bad: unknown[] = [
    undefined,
    null,
    "a diagram of the water cycle",
    42,
    {},
    { kind: "pie-chart", alt: "x" },
    { kind: "bar-model", alt: "x", bars: [] },
    { kind: "bar-model", bars: [{ parts: [{}] }] }, // no alt
    { kind: "bar-model", alt: "x", bars: [{ parts: [{ value: -1 }] }] },
    { kind: "bar-model", alt: "x", bars: [{ label: "a label far too long to fit", parts: [{}] }] },
    {
      kind: "line-graph",
      alt: "x",
      x: { label: "t", min: 0, max: 10 },
      y: { label: "v", min: 0, max: 10 },
      series: [
        {
          points: [
            [0, 0],
            [11, 5],
          ],
        },
      ], // off the axis
    },
    {
      kind: "line-graph",
      alt: "x",
      x: { label: "t", min: 0, max: 10 },
      y: { label: "v", min: 0, max: 10 },
      series: [
        {
          axis: "right",
          points: [
            [0, 0],
            [5, 5],
          ],
        },
      ], // no y2
    },
    {
      kind: "line-graph",
      alt: "x",
      x: { label: "t", min: 10, max: 0 },
      y: { label: "v", min: 0, max: 10 },
      series: [
        {
          points: [
            [0, 0],
            [5, 5],
          ],
        },
      ],
    },
    { kind: "flow", alt: "x", layout: "cycle", steps: [{ label: "a" }, { label: "b" }] },
    { kind: "flow", alt: "x", steps: Array.from({ length: 7 }, () => ({ label: "a" })) },
    { kind: "labelled-diagram", alt: "x", shapes: [{ type: "circle", cx: 150, cy: 50, r: 5 }] },
    { kind: "labelled-diagram", alt: "x", shapes: [{ type: "spline", points: [] }] },
    { kind: "number-line", alt: "x", min: 0, max: 100, step: 1 }, // 100 ticks
    { kind: "number-line", alt: "x", min: 0, max: 10, step: 1, points: [{ value: 12 }] },
    { kind: "table", alt: "x", header: ["a", "b"], rows: [["1"]] },
    { kind: "table", alt: "x", rows: Array.from({ length: 9 }, () => ["a"]) },
  ];

  test.each(bad.map((b, i) => [i, b] as const))("bad spec %d gives undefined", (_, spec) => {
    expect(parseDiagram(spec)).toBeUndefined();
    expect(renderDiagram(spec, chalk, SLOT)).toBeUndefined();
    expect(diagramElement(spec, chalk, { x: 0, y: 0, ...SLOT })).toBeUndefined();
  });

  test("a slot too small to read draws nothing", () => {
    expect(renderDiagram(DIAGRAM_SAMPLES.table, chalk, { w: 40, h: 30 })).toBeUndefined();
  });

  test("random junk never throws", () => {
    let seed = 7;
    const rnd = () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
    const pick = <T>(xs: T[]): T => xs[Math.floor(rnd() * xs.length)] as T;
    const junk = (d: number): unknown =>
      d > 3
        ? pick([1, -1, "x", null, true, 1e308])
        : pick([
            () => Array.from({ length: Math.floor(rnd() * 4) }, () => junk(d + 1)),
            () => ({ kind: pick(DIAGRAM_KINDS), alt: "a", bars: junk(d + 1), rows: junk(d + 1) }),
            () => pick([0, "y", Number.NaN]),
          ])();
    for (let i = 0; i < 300; i++) {
      expect(() => renderDiagram(junk(0), chalk, SLOT)).not.toThrow();
    }
  });
});

describe("the diagram slot (look.ts withDiagramSlot)", () => {
  const slide = (): Slide => ({
    id: "s",
    kind: "content",
    elements: [
      {
        id: "b",
        type: "text",
        x: SAFE.x,
        y: 150,
        w: SAFE.w,
        h: 200,
        doc: docFromText("Words about the water cycle."),
        style: { preset: "body" },
      },
    ],
  });
  let n = 0;
  const ids = () => `id${n++}`;

  test("a spec draws an image element named Diagram in the slot, alt text from the spec", () => {
    const out = withDiagramSlot(slide(), chalk, DIAGRAM_SAMPLES["flow-cycle"] ?? "", ids);
    const img = out.elements.find((e) => e.name === DIAGRAM_DRAWN_NAME);
    expect(img?.type).toBe("image");
    if (img?.type !== "image") return;
    expect(img.src).toStartWith("data:image/svg+xml");
    expect(img.alt).toContain("water cycle");
    expect(img.x + img.w).toBe(SAFE.x + SAFE.w);
    expect(out.elements.some((e) => e.name === DIAGRAM_NAME)).toBe(false);
    const body = out.elements.find((e) => e.id === "b");
    expect(body?.w).toBeLessThan(SAFE.w / 2);
  });

  test("an invalid spec leaves the slide as it was: no box, no placeholder", () => {
    const s = slide();
    expect(withDiagramSlot(s, chalk, { kind: "flow", alt: "x", steps: [] } as never, ids)).toBe(s);
  });

  test("a string instruction still gives the editor's placeholder", () => {
    const out = withDiagramSlot(slide(), chalk, "The water cycle", ids);
    expect(out.elements.some((e) => e.name === DIAGRAM_NAME)).toBe(true);
  });
});
