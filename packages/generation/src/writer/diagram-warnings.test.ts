import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getTheme } from "@tj/slides/themes";
import { sampleBriefLesson } from "../testing";
import { materialise, type Plan } from "./materialise";

/*
 * Greg (10 Oct 2026): a planned visual is never lost. When every room on the slide draws the diagram
 * only with warnings, materialise ships the least-bad drawing and carries its warnings (stage logs
 * them on visual-path) instead of laying the slide out without it.
 */
describe("a diagram that only draws with warnings still ships", () => {
  const out = JSON.parse(
    readFileSync(join(import.meta.dir, "fixtures/writer-outputs/1-base4-3.json"), "utf8"),
  ) as { text: string };
  const plan = JSON.parse(out.text) as Plan;
  const base = {
    brief: { ...sampleBriefLesson().brief, keyStage: "KS1" } as never,
    theme: getTheme(undefined as never, "KS1" as never),
    stage: "KS1" as never,
  };
  const crowded = {
    kind: "labelled-diagram",
    alt: "A small square with six labels",
    canvas: "square",
    shapes: [{ type: "rect", x: 45, y: 45, w: 10, h: 10, fill: "accent" }],
    labels: Array.from({ length: 6 }, (_, k) => ({
      text: `Label number ${k + 1} words`,
      at: [50, 50],
    })),
  };
  const slide = {
    template: "diagram-text",
    heading: "The square",
    lead: "Look at the labels.",
    points: ["One point", "Another point"],
    diagram: { shows: "a square with six labels" },
  };
  const svg = (els: { type: string; src?: string }[]) =>
    els.some((e) => e.type === "image" && String(e.src).startsWith("data:image/svg"));

  test("the strict layout misses; with diagramWarnings the drawing ships with its warnings", () => {
    const ctx: Parameters<typeof materialise>[1] = {
      ...base,
      index: 2,
      plan: { ...plan, slides: [plan.slides[0], plan.slides[1], slide] } as Plan,
      visual: (k) =>
        k === "diagram" ? { status: "diagram", spec: crowded } : { status: "failed" },
    };
    const strict = materialise(slide as never, ctx);
    expect(strict.diagram?.length ?? 0).toBeGreaterThan(0);
    expect(strict.diagramWarnings).toBeUndefined();
    const m = materialise(slide as never, { ...ctx, diagramWarnings: true });
    expect(m.diagram).toBeUndefined();
    expect(m.diagramWarnings?.length ?? 0).toBeGreaterThan(0);
    expect(svg(m.slide.elements as never)).toBe(true);
  });

  test("a spec that does not parse is still a miss", () => {
    const m = materialise(slide as never, {
      ...base,
      index: 2,
      plan: { ...plan, slides: [plan.slides[0], plan.slides[1], slide] } as Plan,
      visual: (k) =>
        k === "diagram"
          ? { status: "diagram", spec: { kind: "labelled-diagram", shapes: [] } }
          : { status: "failed" },
      diagramWarnings: true,
    });
    expect(m.diagram?.length ?? 0).toBeGreaterThan(0);
    expect(m.diagramWarnings).toBeUndefined();
  });
});
