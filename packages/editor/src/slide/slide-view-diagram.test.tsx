import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/react";
import { type Slide, slideStepCount } from "@tj/domain/documents";
import { DIAGRAM_NAME, materialiseSlide, PANEL_NAME, withoutDiagramSlot } from "@tj/slides";
import { buildCount, svgOfDataUrl, withBuilds } from "@tj/slides/diagram-builds";
import { drawDiagram } from "@tj/slides/diagrams";
import { getTheme } from "../model/themes";
import { SlideView } from "./SlideView";

const theme = getTheme("chalk");
const stored = materialiseSlide(
  {
    kind: "content",
    factRefs: [],
    heading: "How a volcano erupts",
    body: "Magma rises through cracks in the crust. Pressure builds as gas collects in the magma chamber. The crust gives way and lava pours out.",
    diagram: "Cross-section: magma chamber, vent, crater, ash cloud",
  },
  "chalk",
  { promptVersion: "t", model: "m", at: "2026-09-26T00:00:00.000Z" },
);
const rendered = (mode: "edit" | "present" | "view" | "capture") => {
  const { container } = render(<SlideView slide={stored} theme={theme} mode={mode} />);
  return [...container.querySelectorAll("[data-element-id]")].map(
    (e) => (e as HTMLElement).dataset.elementId,
  );
};

describe("a diagram instruction with no drawing", () => {
  const slot = stored.elements.find((e) => e.name === DIAGRAM_NAME);
  const panel = withoutDiagramSlot(stored, theme).elements.find((e) => e.name === PANEL_NAME);

  test("the editor keeps the placeholder in the right half", () => {
    expect(slot).toBeDefined();
    expect(rendered("edit")).toContain(slot?.id);
  });

  for (const mode of ["present", "view", "capture"] as const) {
    test(`${mode}: no empty right half, the key idea takes the panel`, () => {
      const ids = rendered(mode);
      expect(ids).not.toContain(slot?.id);
      expect(panel).toBeDefined();
      expect(ids).toContain(panel?.id);
    });
  }
});

/* TEACH-247 part b: a drawing from the diagram drawer (#403) builds one part per step in Present. */
describe("a drawn diagram with builds", () => {
  const flow = {
    kind: "flow",
    alt: "Water evaporates, condenses and falls as rain.",
    layout: "chain",
    steps: [{ label: "Evaporation" }, { label: "Condensation" }, { label: "Rain" }],
  };
  const drawn = withBuilds(() =>
    drawDiagram(flow, theme, { x: 520, y: 160, w: 400, h: 300 }, () => "d1"),
  );
  if (!drawn.ok) throw new Error(drawn.reasons.join("; "));
  const builds = buildCount(svgOfDataUrl(drawn.element.src) ?? "");
  const slide: Slide = { ...stored, elements: [{ ...drawn.element, builds }] };
  const svgAt = (mode: "present" | "edit", step?: number) => {
    const { container } = render(
      <SlideView
        slide={slide}
        theme={theme}
        mode={mode}
        {...(step !== undefined ? { step } : {})}
      />,
    );
    const src = container.querySelector("img")?.getAttribute("src") ?? "";
    return svgOfDataUrl(src) ?? "";
  };

  test("the slide's steps are the builds; each step shows one more part", () => {
    expect(builds).toBe(2);
    expect(slideStepCount(slide)).toBe(2);
    expect(svgAt("present", 0)).toContain('[data-s="1"],[data-s="2"]{opacity:0}');
    expect(svgAt("present", 1)).toContain('[data-s="2"]{opacity:0}');
    expect(svgAt("present", 2)).not.toContain("{opacity:0}");
  });

  test("the editor shows the stored drawing: the last build", () => {
    expect(svgAt("edit")).toBe(svgOfDataUrl(drawn.element.src) ?? "-");
  });

  test("a question slide with no answer reveal shows the drawing's answer part", () => {
    const bm = {
      kind: "bar-model",
      alt: "Two bars and their total.",
      bars: [
        { label: "Sam", parts: [{ value: 6, label: "6" }] },
        { label: "Ali", parts: [{ value: 6, label: "6" }] },
      ],
      combined: "12",
    };
    const d = withBuilds(() =>
      drawDiagram(bm, theme, { x: 520, y: 160, w: 400, h: 300 }, () => "b1"),
    );
    if (!d.ok) throw new Error(d.reasons.join("; "));
    const n = buildCount(svgOfDataUrl(d.element.src) ?? "");
    const q: Slide = {
      ...stored,
      question: { type: "open-response" },
      elements: [{ ...d.element, builds: n }],
    };
    const { container } = render(<SlideView slide={q} theme={theme} mode="present" step={n} />);
    const src = svgOfDataUrl(container.querySelector("img")?.getAttribute("src") ?? "") ?? "";
    expect(src).toContain('data-ans="1"');
    expect(src).not.toContain('[data-ans="1"]{opacity:0}');
  });
});
