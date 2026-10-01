import { describe, expect, test } from "bun:test";
import type { Slide } from "@tj/domain/documents";
import { docFromText } from "../factories";
import { SAFE } from "../grid";
import { DIAGRAM_NAME, withDiagramSlot } from "../look";
import { materialiseSlide, withDiagramDrawn } from "../materialise";
import type { SlideSpec } from "../specs";
import { getTheme, MIN_FONT_SIZE, THEMES } from "../themes";
import {
  DIAGRAM_DRAWN_NAME,
  DIAGRAM_KINDS,
  DiagramSpecSchema,
  diagramElement,
  parseDiagram,
  renderDiagram,
} from "./index";
import { resolveLabels } from "./labelled";
import { DIAGRAM_SAMPLES } from "./samples";
import { context } from "./svg";

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

describe("withDiagramDrawn (generation's diagram slot)", () => {
  const meta = { promptVersion: "t", model: "t", at: "2026-09-30T00:00:00.000Z" };
  const spec = {
    kind: "content",
    heading: "Ratio as a bar",
    body: "Share 20 sweets in the ratio 3 : 2. Draw five equal parts; three go to Ali.",
    diagram: "A bar of five equal parts, three shaded",
    factRefs: [],
  } as unknown as SlideSpec;

  test("a valid spec replaces the placeholder slot with a drawn Diagram image", () => {
    const slide = materialiseSlide(spec, "chalk", meta);
    const drawn = withDiagramDrawn(slide, getTheme("chalk"), DIAGRAM_SAMPLES["bar-model-ratio"]);
    expect(drawn.elements.some((e) => e.type === "image" && e.name === DIAGRAM_DRAWN_NAME)).toBe(
      true,
    );
    expect(drawn.elements.some((e) => e.name === DIAGRAM_NAME)).toBe(false);
    expect(drawn.diagram).toBeUndefined();
  });

  test("an invalid spec leaves the slide as it is", () => {
    const slide = materialiseSlide(spec, "chalk", meta);
    expect(withDiagramDrawn(slide, getTheme("chalk"), { kind: "nonsense" })).toBe(slide);
  });
});

describe("labelled diagram labels (v2)", () => {
  const roads = DIAGRAM_SAMPLES["labelled-roads"];
  const parsed = (spec: unknown) => {
    const s = parseDiagram(spec);
    if (s?.kind !== "labelled-diagram") throw new Error("not a labelled diagram");
    return s;
  };

  test("a label pointing at nothing drawn is dropped; two names for one shape become one", () => {
    const labels = resolveLabels(parsed(roads));
    expect(labels.map((l) => l.text)).toEqual(["Londinium (London)", "Verulamium (St Albans)"]);
    const svg = renderDiagram(roads, chalk, { w: 560, h: 356 }) ?? "";
    expect(svg).not.toContain("Roman road");
    expect(svg.match(/>Londinium/g)?.length).toBe(1);
    expect(svg.match(/>London/g)?.length ?? 0).toBe(0);
  });

  test("a label repeating another's words is dropped", () => {
    const s = parsed({
      kind: "labelled-diagram",
      alt: "x",
      shapes: [
        { type: "circle", cx: 30, cy: 50, r: 10 },
        { type: "circle", cx: 70, cy: 50, r: 10 },
      ],
      labels: [
        { text: "Cell", at: [30, 50], side: "top" },
        { text: " cell ", at: [70, 50], side: "top" },
      ],
    });
    expect(resolveLabels(s)).toHaveLength(1);
  });

  test("a spot on a big shape keeps its leader; a label beside a small shape names all of it", () => {
    const river = resolveLabels(parsed(DIAGRAM_SAMPLES["labelled-river"]));
    expect(river.find((l) => l.text === "valley side")?.part).toBe(true);
    const states = resolveLabels(parsed(DIAGRAM_SAMPLES["labelled-particles-states"]));
    expect(states.map((l) => [l.target, l.part])).toEqual([
      [0, false],
      [1, false],
      [2, false],
    ]);
  });

  test("labels and captions never set below the projector body floor, on a halo", () => {
    for (const t of THEMES) {
      for (const [name, spec] of Object.entries(DIAGRAM_SAMPLES)) {
        if (spec.kind !== "labelled-diagram") continue;
        const svg = renderDiagram(spec, t, SLOT) ?? "";
        const sizes = [...svg.matchAll(/<text[^>]*font-size="([\d.]+)"[^>]*paint-order/g)].map(
          (m) => Number(m[1]),
        );
        expect(sizes.length, name).toBeGreaterThan(0);
        for (const fs of sizes) expect(fs).toBeGreaterThanOrEqual(MIN_FONT_SIZE.body);
      }
    }
  });

  test("particle descriptions sit under their own box, not at the drawing's edge", () => {
    const svg = renderDiagram(DIAGRAM_SAMPLES["labelled-particles-states"], chalk, {
      w: 560,
      h: 356,
    }) as string;
    const y = (word: string) =>
      Number(new RegExp(`y="([\\d.]+)">${word}`).exec(svg)?.[1] ?? Number.NaN);
    expect(y("Close,")).toBeGreaterThan(y("Solid: ice"));
    expect(y("Close,") - y("Solid: ice")).toBeLessThan(MIN_FONT_SIZE.body * 2);
    expect(svg).not.toContain("<line x1"); // whole-box labels need no leader
  });
});

describe("line graph intervals", () => {
  const base = DIAGRAM_SAMPLES["line-graph-hydrograph"] as Record<string, unknown>;

  test("an interval draws a labelled double arrow between its x values", () => {
    const svg = renderDiagram(base, chalk, { w: 560, h: 356 }) ?? "";
    expect(svg).toContain(">lag time<");
    expect(svg.match(/<polygon/g)?.length).toBeGreaterThanOrEqual(2);
  });

  test("an interval off the axis, or backwards, does not parse", () => {
    expect(parseDiagram({ ...base, intervals: [{ from: 14, to: 6, label: "lag" }] })).toBe(
      undefined,
    );
    expect(parseDiagram({ ...base, intervals: [{ from: 6, to: 40, label: "lag" }] })).toBe(
      undefined,
    );
    expect(parseDiagram({ ...base, intervals: [{ from: 6, to: 14, label: "lag", y: 90 }] })).toBe(
      undefined,
    );
    expect(
      parseDiagram({ ...base, intervals: [{ from: 6, to: 14, label: "lag", y: 36 }] }),
    ).toBeDefined();
  });
});

describe("label contrast", () => {
  const lum = (h: string) => {
    const v = Number.parseInt(h.slice(1), 16);
    return [16, 8, 0]
      .map((s) => {
        const c = ((v >> s) & 255) / 255;
        return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
      })
      .reduce((a, c, i) => a + c * ([0.2126, 0.7152, 0.0722][i] ?? 0), 0);
  };
  const ratio = (a: string, b: string) => {
    const [x, y] = [lum(a), lum(b)];
    return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
  };

  test.each(THEMES.map((t) => t.id))("every text-on-fill pair reads at 4.5:1 (%s)", (id) => {
    const t = getTheme(id);
    const { c } = context(t, SLOT.w, SLOT.h);
    const pairs: [string, string, string][] = [
      ["ink on tint", c.ink, c.tint],
      ["ink on tint2", c.ink, c.tint2],
      ["onAccent on accent", c.onAccent, c.accent],
      ["ink on surface", c.ink, c.surface],
      ["ink on ground (label halo)", c.ink, c.bg],
      ["muted on ground", c.muted, c.bg],
      ["muted on surface", c.muted, c.surface],
      ["accent on ground", c.accent, c.bg],
    ];
    for (const [what, fg, bg] of pairs) expect(ratio(fg, bg), what).toBeGreaterThanOrEqual(4.5);
  });
});

describe("tables", () => {
  const y7 = {
    kind: "table" as const,
    alt: "Particle arrangement and movement in ice, water and water vapour.",
    title: "Water in three states",
    header: ["State", "Arrangement", "Movement"],
    rows: [
      ["Solid: ice", "Close, fixed pattern", "Vibrate on the spot"],
      ["Liquid: water", "Close together", "Move past each other"],
      ["Gas: water vapour", "Far apart", "Move freely"],
    ],
  };

  test("every cell is drawn whole, with no ellipsis, in a half-width slot", () => {
    for (const theme of THEMES) {
      const svg = renderDiagram(y7, theme, { w: 400, h: 356 });
      expect(svg).not.toContain("…");
      expect(svg).toContain(">vapour<");
    }
  });
});

describe("table width (round A6)", () => {
  test("a three-column table at the larger label size stays inside its panel", () => {
    const { drawTable } = require("./table") as typeof import("./table");
    const { context } = require("./svg") as typeof import("./svg");
    const x = context(getTheme("chalk"), 403, 340);
    const svg = drawTable(
      {
        kind: "table",
        header: ["Shape", "Volume", "Compressibility"],
        rows: [
          ["Fixed", "Fixed", "Hardly, close particles"],
          ["Container's shape", "Fixed", "Hardly, close particles"],
          ["Container's shape", "Container's volume", "Easy: large gaps"],
        ],
      } as never,
      x,
      403,
      340,
    );
    const rects = [...svg.matchAll(/<rect x="([-\d.]+)" y="[-\d.]+" width="([\d.]+)"/g)];
    expect(rects.length).toBeGreaterThan(0);
    for (const m of rects) {
      expect(Number(m[1])).toBeGreaterThanOrEqual(-0.5);
      expect(Number(m[1]) + Number(m[2])).toBeLessThanOrEqual(403.5);
    }
  });
});
