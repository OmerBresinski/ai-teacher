import { describe, expect, test } from "bun:test";
import { atKeyStage, getTheme, THEMES } from "../themes";
import DRAWER from "./drawer-specs.fixture.json";
import { labelClashes } from "./geometry";
import { DIAGRAM_SAMPLES, drawDiagram, renderDiagram } from "./index";
import { resolveLabels } from "./labelled";
import { MEANING_SAMPLES } from "./meaning-samples";
import type { LabelledDiagram } from "./schema";
import { TEMPLATE_SPECS } from "./template-specs";
import H1 from "./writer-specs.fixture.json";

// Register diagrams-02: labels on a drawer's drawing (a labelled diagram) never sit on each other,
// never have a line or a leader across them, never hide another label's point, and every leader
// ends on a drawn part. Swept over the never-throw corpus and the replay fixtures (the drawer's
// own specs from the y8 French and y11 rates lessons), in the zones slides give a drawing.
const corpus = Object.entries({
  ...DIAGRAM_SAMPLES,
  ...TEMPLATE_SPECS,
  ...MEANING_SAMPLES,
  ...(H1 as Record<string, unknown>),
  ...(DRAWER as Record<string, unknown>),
}).filter(([, s]) => (s as { kind?: string }).kind === "labelled-diagram");
const ZONES = [
  { w: 348, h: 284 },
  { w: 788, h: 235 },
  { w: 403, h: 336 },
  { w: 300, h: 420 },
  { w: 860, h: 380 },
];

describe("REGISTER diagrams-02: labels on drawer drawings read clear", () => {
  test("the sweep holds the drawer's replay specs", () => {
    expect(corpus.length).toBeGreaterThan(12);
  });
  test("no label on another, across a line or leader, or over a point; leaders end on a part", () => {
    const bad: string[] = [];
    for (const theme of THEMES.filter((_, i) => i % 3 === 0))
      for (const ks of ["ks1", "ks2", "ks3", "ks4"]) {
        const t = atKeyStage(theme, ks);
        for (const [name, spec] of corpus)
          for (const z of ZONES) {
            const r = drawDiagram(spec, t, { x: 0, y: 0, ...z });
            if (!r.ok) continue;
            const f = labelClashes(r.spec, t, { ...z, fs: r.fs });
            if (f.length) bad.push(`${name} ${theme.id} ${ks} ${z.w}x${z.h}: ${f.join("; ")}`);
          }
      }
    expect(bad).toEqual([]);
  }, 240_000);
});

// Register prod-06 (pr440-paid-4 s3, rebuilt from the shot): the drawer drew a bear and, beside it,
// a small body cross-section that touches nothing, and hung "Thick fur" and "Fat layer" on that
// floating square; "Wide paws" pointed at the snow line under a paw.
const BEAR = {
  kind: "labelled-diagram",
  alt: "A polar bear stands on snow beside a small body cross-section showing thick fur above a fat layer, and a broad paw resting on the snow.",
  canvas: "wide",
  shapes: [
    {
      type: "polygon",
      points: [
        [22, 52],
        [32, 38],
        [72, 38],
        [80, 32],
        [90, 36],
        [90, 48],
        [82, 52],
        [82, 72],
        [74, 72],
        [72, 58],
        [46, 72],
        [36, 58],
      ],
      fill: "surface",
    },
    {
      type: "line",
      points: [
        [10, 72],
        [100, 72],
      ],
    },
    { type: "rect", x: 112, y: 22, w: 34, h: 34, fill: "accent2", rounded: true },
    { type: "rect", x: 120, y: 30, w: 18, h: 17, fill: "accent" },
  ],
  labels: [
    { text: "Thick fur", at: [115, 28] },
    { text: "Fat layer", at: [129, 38] },
    { text: "Wide paws", at: [42, 72] },
  ],
} as unknown as LabelledDiagram;

describe("REGISTER prod-06: a drawer's close-up is tied to what it shows", () => {
  test("a point on a line beside a paw names the paw, not the line", () => {
    const paws = resolveLabels(BEAR).find((l) => l.text === "Wide paws");
    expect(BEAR.shapes[paws?.target ?? -1]?.type).toBe("polygon");
    expect(paws?.part).toBe(true);
  });
  test("the floating close-up is joined to the bear by a dashed line from its edge", () => {
    const svg = renderDiagram(BEAR, getTheme("studio"), { w: 392, h: 328 }) ?? "";
    const link = /<polyline points="([^"]+)"[^>]*stroke-dasharray/.exec(svg);
    expect(link).not.toBeNull();
  });
  test("a close-up beside nothing larger, or one that touches the drawing, gets no link", () => {
    const alone = { ...BEAR, shapes: BEAR.shapes.slice(2), labels: BEAR.labels.slice(0, 2) };
    const touching = {
      ...BEAR,
      shapes: [
        ...BEAR.shapes,
        {
          type: "line",
          points: [
            [92, 40],
            [112, 40],
          ],
        },
      ],
    } as LabelledDiagram;
    for (const s of [alone, touching]) {
      const svg = renderDiagram(s, getTheme("studio"), { w: 392, h: 328 }) ?? "";
      expect(svg.match(/stroke-dasharray/g)?.length ?? 0).toBe(0);
    }
  });
});
