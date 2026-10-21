import { describe, expect, test } from "bun:test";
import { getTheme } from "../themes";
import { layoutTemplate, type TemplateInput } from "./index";

/*
 * Greg (10 Oct 2026): a planned visual is never lost. When every room a slide offers its diagram
 * draws it only with warnings, `diagramWarnings` ships the least-bad drawing with its faults rather
 * than laying the slide out without it.
 */
describe("a planned visual is never lost to warnings", () => {
  // Six long labels all naming one small square: no placement clears them in any room at KS1.
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
  const input = {
    template: "diagram-text",
    heading: "The square",
    lead: "Look at the labels.",
    points: ["One point", "Another point"],
    figure: { diagram: crowded },
  } as unknown as TemplateInput;
  const lay = (diagramWarnings?: boolean) =>
    layoutTemplate(input, getTheme("studio", "ks1" as never), "ks1", { diagramWarnings });
  const drawing = (r: ReturnType<typeof lay>) =>
    r.slide.elements.find(
      (e) => e.type === "image" && String((e as { src?: string }).src).startsWith("data:image/svg"),
    );

  test("the strict layout misses every room and reports why", () => {
    const r = lay();
    expect(r.diagram?.length ?? 0).toBeGreaterThan(0);
    expect(drawing(r)).toBeUndefined();
  });

  test("with diagramWarnings the drawing ships and its faults come back as warnings", () => {
    const r = lay(true);
    expect(r.diagram).toBeUndefined();
    expect(r.diagramWarnings?.length ?? 0).toBeGreaterThan(0);
    expect(drawing(r)).toBeDefined();
  });

  test("a clean diagram carries no warnings either way", () => {
    const clean = {
      ...input,
      figure: {
        diagram: {
          ...crowded,
          labels: [{ text: "Square", at: [50, 50] }],
        },
      },
    } as unknown as TemplateInput;
    const r = layoutTemplate(clean, getTheme("studio", "ks1" as never), "ks1", {
      diagramWarnings: true,
    });
    expect(r.diagram).toBeUndefined();
    expect(r.diagramWarnings).toBeUndefined();
    expect(drawing(r)).toBeDefined();
  });
});
