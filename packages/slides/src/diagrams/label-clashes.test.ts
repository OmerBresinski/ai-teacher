import { describe, expect, test } from "bun:test";
import { atKeyStage, THEMES } from "../themes";
import DRAWER from "./drawer-specs.fixture.json";
import { labelClashes } from "./geometry";
import { DIAGRAM_SAMPLES, drawDiagram } from "./index";
import { MEANING_SAMPLES } from "./meaning-samples";
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
