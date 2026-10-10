import { describe, expect, test } from "bun:test";
import type { DiagramSource, ImageElement } from "@tj/domain/documents";
import { activityFixtures } from "../templates/activity-fixtures";
import { layoutTemplate, type TemplateInput } from "../templates/index";
import { getTheme, THEMES } from "../themes";
import { drawDiagram } from "./draw";
import { diagramElement, fittedDiagramElement, redrawDiagram } from "./index";
import { DIAGRAM_SAMPLES } from "./samples";

/*
 * TEACH-97 part h: every drawn diagram keeps the spec it was drawn from, and a library drawing
 * placed by a template keeps the model and params it came with, so the settings panel (part g)
 * can redraw it in place.
 */
const theme = getTheme("chalk");
const RECT = { x: 40, y: 120, w: 520, h: 340 };

describe("diagramElement keeps its spec (TEACH-97 part h)", () => {
  test("every sample's element carries the drawer spec, and redrawing it gives the same drawing", () => {
    let drawn = 0;
    for (const [name, spec] of Object.entries(DIAGRAM_SAMPLES)) {
      const el = diagramElement(spec, theme, RECT, () => "d1");
      if (!el) continue;
      drawn++;
      expect(el.diagram?.kind, name).toBe("drawer");
      const again = diagramElement((el.diagram as { spec: unknown }).spec, theme, RECT, () => "d1");
      expect(again?.src, name).toBe(el.src);
    }
    expect(drawn).toBeGreaterThan(5);
  });

  test("the stored spec is plain JSON and much smaller than the drawing", () => {
    const el = diagramElement(DIAGRAM_SAMPLES["flow-cycle"], theme, RECT);
    expect(el).toBeDefined();
    const json = JSON.stringify(el?.diagram);
    expect(JSON.parse(json)).toEqual(el?.diagram);
    expect(json.length).toBeLessThan((el?.src.length ?? 0) / 4);
  });

  test("fittedDiagramElement keeps the spec it settled on", () => {
    const r = fittedDiagramElement(Object.values(DIAGRAM_SAMPLES)[0], theme, RECT);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.element.diagram?.kind).toBe("drawer");
  });
});

describe("a drawn figure's source reaches its image element (TEACH-97 part h)", () => {
  const source: DiagramSource = {
    kind: "library",
    model: "number_line",
    params: { start: 0, end: 20, step: 5 },
    step: 1,
  };
  const diagrams = (els: { type: string }[]) =>
    els.filter(
      (e): e is ImageElement => e.type === "image" && (e as ImageElement).name === "Diagram",
    );

  test("a big-diagram slide's library drawing keeps model and params", () => {
    const fx = activityFixtures((n) => ({ src: `/files/${n}.jpg`, aspect: 4 / 3 }));
    const label = fx.find((f) => f.name === "label");
    const src = (label?.input.figure as { drawn: { src: string } } | undefined)?.drawn.src ?? "";
    const input = {
      template: "big-diagram",
      heading: "Count on in fives",
      figure: { drawn: { src, aspect: 400 / 420, alt: "A number line", bare: true, source } },
    } as unknown as TemplateInput;
    const els = diagrams(layoutTemplate(input, theme, "ks2").slide.elements);
    expect(els.length).toBe(1);
    expect(els[0]?.diagram).toEqual(source);
  });

  test("a label activity's drawn picture keeps its source", () => {
    const fx = activityFixtures((n) => ({ src: `/files/${n}.jpg`, aspect: 4 / 3 }));
    const label = fx.find((f) => f.name === "label");
    const input = structuredClone(label?.input) as TemplateInput & {
      figure: { drawn: Record<string, unknown> };
    };
    input.figure.drawn.source = source;
    const els = diagrams(layoutTemplate(input, getTheme("splash"), "ks1").slide.elements);
    expect(els.length).toBe(1);
    expect(els[0]?.diagram).toEqual(source);
  });

  test("a drawn figure without a source makes an element with no diagram key", () => {
    const fx = activityFixtures((n) => ({ src: `/files/${n}.jpg`, aspect: 4 / 3 }));
    const label = fx.find((f) => f.name === "label");
    const els = diagrams(
      layoutTemplate(label?.input as TemplateInput, getTheme("splash"), "ks1").slide.elements,
    );
    expect(els.length).toBe(1);
    expect("diagram" in (els[0] as object)).toBe(false);
  });
});

describe("redrawDiagram gives back the stored drawing, byte for byte (TEACH-97 part h)", () => {
  type Drawer = Extract<DiagramSource, { kind: "drawer" }>;
  const again = (el: ImageElement, rect = RECT) =>
    redrawDiagram(JSON.parse(JSON.stringify(el.diagram)) as Drawer, theme, rect, () => el.id);

  test("every sample settled by the fit ladder (drawDiagram, label size stepped down)", () => {
    let settled = 0;
    for (const [name, spec] of Object.entries(DIAGRAM_SAMPLES)) {
      for (const rect of [RECT, { x: 600, y: 140, w: 300, h: 220 }]) {
        const r = drawDiagram(spec, theme, rect, () => "d1");
        if (!r.ok) continue;
        const d = r.element.diagram as Drawer;
        if (d.fs !== undefined) settled++;
        expect(again(r.element, rect)?.src, name).toBe(r.element.src);
      }
    }
    expect(settled).toBeGreaterThan(5);
  });

  test("a long-label drawing stores its mode and size and redraws the same", () => {
    const spec = {
      kind: "particles",
      alt: "a drawing",
      title: "From solid to liquid to gas",
      show: "states",
      states: ["solid", "liquid", "gas"],
      notes: [
        "Close, regular; vibrate in place",
        "Close, irregular; move past",
        "Far apart; move freely",
      ],
      arrows: ["Melting", "Boiling"],
    };
    const zone = { x: 664, y: 120, w: 560, h: 520 };
    const t = THEMES[0] ?? theme;
    const r = fittedDiagramElement(spec, t, zone, () => "d1");
    expect(r.ok && r.stretched).toBe(true);
    if (!r.ok) return;
    const d = r.element.diagram as Drawer;
    expect(d.longLabels).toBe(true);
    expect(d.fs).toBe(r.fs);
    const back = redrawDiagram(JSON.parse(JSON.stringify(d)) as Drawer, t, zone, () => "d1");
    expect(back?.src).toBe(r.element.src);
    // Without the stored mode it would not even parse.
    expect(diagramElement(d.spec, t, zone)).toBeUndefined();
  });
});
